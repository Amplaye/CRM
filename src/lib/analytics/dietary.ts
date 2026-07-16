/**
 * Dietary-request detection.
 *
 * Scans free text (chat/voice transcripts, conversation summaries,
 * reservation notes/allergies, guest notes) for mentions of the four diet
 * types the owner cares about. Multilingual (IT/ES/EN/DE), accent and
 * whitespace tolerant.
 *
 * A single source item (one conversation, one reservation, one guest)
 * should be counted at most once per category by the caller, so the
 * resulting chart reflects "how many requests" rather than raw word hits.
 */

export type DietKey = "lactose" | "gluten" | "vegetarian" | "vegan";

export const DIET_KEYS: DietKey[] = ["lactose", "gluten", "vegetarian", "vegan"];

/**
 * Regex per category. Case-insensitive, \b-anchored. "vegan" is tested
 * before "vegetarian" in {@link detectDiets} so a vegan mention does not
 * also trip the vegetarian matcher unless the text mentions both.
 */
export const DIET_PATTERNS: Record<DietKey, RegExp> = {
  lactose: /\b(senza\s+lattosio|intoller\w*\s+(al\s+)?lattosio|sin\s+lactosa|lactose[\s-]?free|laktosefrei|laktose\w*|lactos\w*|lattosio)\b/i,
  gluten: /\b(senza\s+glutine|celiac\w*|cel[ií]ac\w*|coeliac\w*|z[öo]liakie|sin\s+gluten|gluten[\s-]?free|glutenfrei|glutine|gluten)\b/i,
  vegan: /\b(vegan\w*|vegano|vegana|veganer\w*)\b/i,
  vegetarian: /\b(vegetarian\w*|vegetarian[oa]|vegetariano|vegetariana|vegetarisch\w*|veggie)\b/i,
};

/** Returns the set of dietary categories mentioned anywhere in `text`. */
export function detectDiets(text: string): Set<DietKey> {
  const hits = new Set<DietKey>();
  if (!text) return hits;
  // Order matters: vegan before vegetarian (see note above).
  if (DIET_PATTERNS.vegan.test(text)) hits.add("vegan");
  if (DIET_PATTERNS.vegetarian.test(text)) hits.add("vegetarian");
  if (DIET_PATTERNS.lactose.test(text)) hits.add("lactose");
  if (DIET_PATTERNS.gluten.test(text)) hits.add("gluten");
  return hits;
}
