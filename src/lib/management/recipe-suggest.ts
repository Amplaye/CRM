// AI recipe suggestion — the pure half. Turns a dish (name + description) into a
// draft ingredient list the owner reviews before it's saved as recipe_items.
//
// The heavy lifting is REUSED, not reinvented: the LLM only proposes a rough
// {name, qty, unit} list, then suggestLineMatches() (the same fuzzy matcher the
// invoice importer uses) snaps each suggested name onto the tenant's real
// warehouse rows with the identical high/med/none tiers. Unmatched suggestions
// come back as "create this ingredient" proposals. No math lives in the route,
// so all of it is unit-tested here.
//
// Pure and total: no DB, no I/O. The route fetches the ingredients and calls the
// model; this module builds the prompt, parses the reply, and resolves matches.

import { suggestLineMatches } from "./ingredient-match";
import type { MatchCandidate, MatchConfidence } from "./ingredient-match";
import { normalizeUnit } from "./ingredient-match";
import type { Unit } from "./units";

/** The dish we ask the model to draft a recipe for. */
export interface RecipeDish {
  menuItemId: string;
  name: string;
  description?: string | null;
  price?: number | null;
}

/** One raw line as the model returns it (before snapping to the warehouse). */
export interface SuggestedLine {
  name: string;
  qty: number;
  unit: string;
}

/** A suggested line after it's been matched against the tenant's ingredients. */
export interface ResolvedLine {
  suggestedName: string;
  qty: number;
  unit: string;
  match: {
    ingredientId: string | null;
    confidence: MatchConfidence;
    /** Name to show / to create the ingredient with when there's no match. */
    proposalName: string;
    /** Warehouse unit to create the ingredient with when there's no match. */
    proposalUnit: Unit;
  };
}

/**
 * Build the chat messages that ask the model for a per-portion ingredient list.
 * The tenant's real ingredient names are handed in so the model prefers them —
 * that grounding is what makes suggestLineMatches() land a high-confidence match
 * instead of a "create new" every time.
 */
export function buildRecipePrompt(
  dish: RecipeDish,
  ingredientNames: string[],
): Array<{ role: string; content: string }> {
  const known = ingredientNames.filter(Boolean).slice(0, 300);
  const system = `You are a chef drafting the ingredient list for ONE portion of a restaurant dish. Your ONLY output is a strict JSON object, no prose, no markdown fences.

Return exactly: {"ingredients":[{"name":string,"qty":number,"unit":string}]}

Rules:
- Include ONLY ingredients you are confident are actually in THIS specific dish, judging from its name and description. Do not pad the list with plausible-but-unlisted extras.
- STRONGLY prefer names from the KNOWN INGREDIENTS list below: that is the restaurant's real warehouse. Reuse a known name verbatim whenever it plausibly fits the dish.
- Only invent a new (non-listed) ingredient when it is clearly essential to the dish AND no known ingredient covers it. Every invented ingredient is extra manual work for the owner, so keep these to the strict minimum.
- If the dish name is vague, generic, or you cannot tell what is in it, it is CORRECT to return few ingredients — or an empty list {"ingredients":[]}. Never guess a whole recipe from a name you don't recognise.
- "qty" is the amount for that single portion, as a positive number. "unit" is one of: "g" (grams), "ml" (millilitres) or "pz" (pieces/units). Use g for solids, ml for liquids, pz for countable items (eggs, buns).
- Quantities are best-effort estimates the owner will review and correct. Skip water, salt and pepper unless central to the dish.`;

  const knownBlock = known.length > 0
    ? `KNOWN INGREDIENTS (the real warehouse — reuse these names whenever they fit; only go outside this list for something clearly essential and truly missing):\n${known.join(", ")}`
    : `KNOWN INGREDIENTS: (the warehouse is empty — the owner has not stocked anything yet. Propose only the few core ingredients you are sure the dish contains, or return an empty list if the name is unclear.)`;

  const desc = (dish.description || "").trim();
  const user = `Dish: ${dish.name}${desc ? `\nDescription: ${desc}` : ""}

${knownBlock}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Tolerant parse of the model's reply into SuggestedLine[]. Total — never
 * throws. Accepts either the documented {"ingredients":[...]} shape or a bare
 * array, drops any malformed entry (missing name, non-positive qty), and clamps
 * the unit to a known token via normalizeUnit.
 */
export function parseRecipeSuggestion(content: string): SuggestedLine[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    // Sometimes the model wraps the JSON in prose or a code fence despite the
    // instruction — salvage the first {...} or [...] block.
    const m = (content || "").match(/[[{][\s\S]*[\]}]/);
    if (!m) return [];
    try {
      data = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }

  const arr: unknown = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as any).ingredients)
      ? (data as any).ingredients
      : null;
  if (!Array.isArray(arr)) return [];

  const out: SuggestedLine[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    const qtyNum = typeof r.qty === "number" ? r.qty : Number(r.qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) continue;
    const unit = typeof r.unit === "string" ? r.unit : "";
    out.push({ name: name.slice(0, 80), qty: qtyNum, unit });
  }
  return out;
}

/**
 * Snap each suggested line onto the tenant's warehouse. Wraps every line as a
 * synthetic LineToMatch and runs the SAME suggestLineMatches() the invoice
 * importer uses, so the confidence tiers and the "create ingredient" proposals
 * are identical to what the owner already knows from deliveries.
 */
export function resolveSuggestion(
  lines: SuggestedLine[],
  ingredients: MatchCandidate[],
): ResolvedLine[] {
  const toMatch = lines.map((l, i) => ({
    id: String(i),
    description: l.name,
    unit: l.unit || null,
    quantity: l.qty,
  }));
  const matches = suggestLineMatches(toMatch, ingredients);
  const byId = new Map(matches.map((m) => [m.lineId, m]));

  return lines.map((l, i) => {
    const m = byId.get(String(i));
    // The AI already tells us the unit; keep it as the fallback create-unit so a
    // "create" row is born with grams/ml/pz rather than the matcher's guess.
    const aiUnit = normalizeUnit(l.unit);
    return {
      suggestedName: l.name,
      qty: l.qty,
      unit: l.unit || aiUnit,
      match: {
        ingredientId: m?.ingredientId ?? null,
        confidence: m?.confidence ?? "none",
        proposalName: m?.proposal.name || l.name,
        // Prefer the AI's own unit for a create row: it saw the ingredient, not
        // a supplier line, so "ml" from the model beats the matcher's pack-format
        // guess (which can read "l" out of unrelated text).
        proposalUnit: aiUnit,
      },
    };
  });
}
