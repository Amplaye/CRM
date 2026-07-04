// Invoice-line → ingredient auto-matching. A supplier invoice says
// "FARINA TIPO 00 SACCO 25KG" while the warehouse row is just "Farina 00": the
// owner shouldn't have to map those by hand on every delivery. This module
// scores every (line, ingredient) pair with a token-based fuzzy match tuned for
// Italian product names (accents, plurals, packaging noise) so the review step
// arrives pre-filled — high-confidence matches are applied automatically, the
// rest fall back to a "create new ingredient" proposal built from the line.
//
// Pure and total: no DB, no I/O. Callers (the invoice upload route) fetch the
// tenant's ingredients and persist whatever this suggests.

import { compatible } from "./units";
import type { Unit } from "./units";

export type MatchConfidence = "high" | "medium" | "none";

export interface MatchCandidate {
  id: string;
  name: string;
  unit: string;
}

export interface LineToMatch {
  id: string;
  description: string;
  unit?: string | null;
}

export interface LineMatch {
  lineId: string;
  ingredientId: string | null;
  score: number;
  confidence: MatchConfidence;
  /** Ready-made ingredient proposal for unmatched lines (cleaned name + unit). */
  proposal: { name: string; unit: Unit };
}

// Packaging / commercial noise that says nothing about WHAT the product is.
const NOISE_TOKENS = new Set([
  "sacco", "sacchi", "cartone", "cartoni", "scatola", "scatole", "confezione",
  "confezioni", "conf", "cf", "ct", "busta", "buste", "vaschetta", "vaschette",
  "bottiglia", "bottiglie", "bott", "latta" /* NOT "latte" — that's milk */,
  "lattina", "lattine", "fusto", "fusti", "cassa", "casse", "pacco", "pacchi",
  "pezzi", "pezzo", "kg", "gr", "g", "hg", "lt", "l", "ml", "cl", "pz", "nr",
  "n", "x", "da", "di", "del", "della", "con", "per", "al", "alla", "in", "the",
]);

// Invoice unit labels → warehouse units. Anything count-like or unknown → pz.
const UNIT_SYNONYMS: Record<string, Unit> = {
  g: "g", gr: "g", grammi: "g", gramm: "g",
  kg: "kg", chilo: "kg", chili: "kg", kilo: "kg",
  ml: "ml", cl: "ml", // cl mapped to the volume dimension; qty stays as written
  l: "l", lt: "l", litri: "l", litro: "l",
  pz: "pz", nr: "pz", n: "pz", pcs: "pz", pce: "pz", cad: "pz", conf: "pz",
  cf: "pz", ct: "pz", cart: "pz", box: "pz", scat: "pz", bott: "pz", kt: "pz",
};

/** Map a free-text invoice unit ("LT.", "Nr", "CF") to a warehouse unit. */
export function normalizeUnit(raw?: string | null): Unit {
  const k = (raw || "").toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_SYNONYMS[k] || "pz";
}

const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Crude Italian stem: singular/plural and gender endings collapse together
 * ("pomodori"/"pomodoro" → "pomodor"). Only for tokens long enough to survive. */
const stem = (t: string) => (t.length >= 4 && /[aeiou]$/.test(t) ? t.slice(0, -1) : t);

/** Meaningful, stemmed tokens of a product name / invoice description. */
export function nameTokens(s: string): string[] {
  return stripAccents(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0)
    // Drop pack sizes ("25kg", "6x1", "1000") but keep short type codes ("00").
    .filter((t) => !/^\d+(?:[a-z]+|x\d+.*)?$/.test(t) || (/^\d+$/.test(t) && t.length <= 2))
    .filter((t) => !NOISE_TOKENS.has(t))
    .map(stem);
}

const tokenCredit = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.7;
  return 0;
};

/** Similarity in [0,1] between an invoice description and an ingredient name.
 * Weighs coverage of the (short) ingredient name over the (verbose) line. */
export function matchScore(description: string, ingredientName: string): number {
  const line = nameTokens(description);
  const ing = nameTokens(ingredientName);
  if (line.length === 0 || ing.length === 0) return 0;
  const cover = (targets: string[], pool: string[]) =>
    targets.reduce((s, t) => s + Math.max(...pool.map((p) => tokenCredit(t, p)), 0), 0) / targets.length;
  return (2 * cover(ing, line) + cover(line, ing)) / 3;
}

/** Cleaned, human-facing ingredient name proposed from an invoice line. */
export function proposeName(description: string): string {
  const words = stripAccents(description.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0)
    .filter((t) => !/^\d+(?:[a-z]+|x\d+.*)?$/.test(t) || (/^\d+$/.test(t) && t.length <= 2))
    .filter((t) => !NOISE_TOKENS.has(t));
  const cleaned = words.map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)));
  return (cleaned.join(" ") || description.trim()).slice(0, 80);
}

/**
 * Match every invoice line against the warehouse. High-confidence matches are
 * safe to auto-apply; medium ones are pre-selected but flagged for review; the
 * rest come back with a ready "create this ingredient" proposal.
 */
export function suggestLineMatches(lines: LineToMatch[], ingredients: MatchCandidate[]): LineMatch[] {
  return lines.map((line) => {
    let best: MatchCandidate | null = null;
    let bestScore = 0;
    for (const ing of ingredients) {
      let s = matchScore(line.description, ing.name);
      // A unit in the wrong dimension (line in litres, ingredient in kg) makes a
      // same-name match suspicious — dampen rather than forbid (invoice units lie).
      if (line.unit && !compatible(normalizeUnit(line.unit), ing.unit)) s *= 0.85;
      if (s > bestScore) {
        bestScore = s;
        best = ing;
      }
    }
    const confidence: MatchConfidence = bestScore >= 0.82 ? "high" : bestScore >= 0.5 ? "medium" : "none";
    return {
      lineId: line.id,
      ingredientId: confidence === "none" ? null : best!.id,
      score: Math.round(bestScore * 100) / 100,
      confidence,
      proposal: { name: proposeName(line.description), unit: normalizeUnit(line.unit) },
    };
  });
}
