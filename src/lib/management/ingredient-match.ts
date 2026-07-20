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
import { deriveLine } from "./pack-size";
import type { DerivedLine } from "./pack-size";
import { classifyLine } from "./line-kind";
import type { LineKind } from "./line-kind";

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
  quantity?: number | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
}

export interface LineMatch {
  lineId: string;
  ingredientId: string | null;
  score: number;
  confidence: MatchConfidence;
  /** Ready-made ingredient proposal for unmatched lines (cleaned name + unit). */
  proposal: { name: string; unit: Unit };
  /** What this line IS: goods go to the warehouse, services/charges don't. */
  kind: LineKind;
  /** The line converted into real units (pack format read from the text). */
  derived: DerivedLine;
}

// Packaging / commercial noise that says nothing about WHAT the product is.
const NOISE_TOKENS = new Set([
  "sacco", "sacchi", "cartone", "cartoni", "scatola", "scatole", "confezione",
  "confezioni", "conf", "cf", "ct", "car", "crt", "collo", "colli", "busta",
  "buste", "vaschetta", "vaschette", "barattolo", "barattoli", "secchio",
  "bottiglia", "bottiglie", "bott", "latta" /* NOT "latte" — that's milk */,
  "lattina", "lattine", "fusto", "fusti", "cassa", "casse", "pacco", "pacchi",
  "pezzi", "pezzo", "kg", "gr", "g", "hg", "lt", "l", "ml", "cl", "cc", "pz", "nr",
  "n", "x", "da", "di", "del", "della", "con", "per", "al", "alla", "in", "the",

  // Trade jargon printed on every Italian foodservice line. These describe how
  // the goods were processed or graded, never what they ARE, so a name built
  // from them ("Vongole C Cappuccine 0 60 80") is unusable in the warehouse.
  "iqf",              // individually quick frozen
  "sg", "sgusciato", "sgusciate", "sgusciati",
  "sp",               // senza pelle
  "cg",               // con guscio
  "an",               // anelli
  "ec",               // extra crispy / calibro extra, supplier-specific
  "dev", "deveined",
  "pp",               // pronto porzione
  "atm",              // atmosfera protettiva
  "sv", "sottovuoto",
  "surgelato", "surgelati", "surgelata", "surgelate",
  "congelato", "congelati", "congelata", "congelate",
  "decongelato", "decongelata",
  // NOT "fresco"/"fresca" — panna fresca vs panna UHT, pasta fresca vs secca,
  // pesce fresco vs surgelato are different goods at different prices.
  "glassato", "glassata", "glassatura", "glassate",
  "calibro", "cal",
  // NOT "cotto"/"crudo" — prosciutto cotto and prosciutto crudo are different
  // goods, and these tokens are the only thing telling them apart.
  "prodotto", "prod", "art", "articolo", "rif",
  "qualita", "quality", "extra", "primo", "prima", "scelta",
  "assortito", "assortiti", "misto", "misti",
]);

// Invoice unit labels → warehouse units. Anything count-like or unknown → pz.
const UNIT_SYNONYMS: Record<string, Unit> = {
  g: "g", gr: "g", grammi: "g", gramm: "g", hg: "g",
  kg: "kg", kgm: "kg", kil: "kg", kili: "kg", chilo: "kg", chili: "kg", kilo: "kg",
  ml: "ml", cl: "ml", cc: "ml", // volume dimension; qty stays as written
  l: "l", lt: "l", ltr: "l", litri: "l", litro: "l",
  pz: "pz", pzi: "pz", nr: "pz", n: "pz", num: "pz", pcs: "pz", pce: "pz",
  cad: "pz", ud: "pz", conf: "pz", cf: "pz", ct: "pz", crt: "pz", cart: "pz",
  car: "pz", box: "pz", scat: "pz", sc: "pz", bott: "pz", bt: "pz", kt: "pz",
  cs: "pz", cassa: "pz", pf: "pz",
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

/**
 * Cleaned, human-facing ingredient name proposed from an invoice line.
 *
 * Supplier lines are dense with things the warehouse must not inherit:
 *   VONGOLE C/G "CAPPUCCINE" 0% 60/80 CF.1 KG (X10)
 * The brand sits in quotes, "0%" is glazing, "60/80" the calibro, the rest is
 * packaging. All of it goes, leaving "Vongole" — a name an owner recognises on
 * a stock count. Brands are dropped deliberately: the warehouse tracks the
 * ingredient, and the same clam arrives under a different label next month.
 */
export function proposeName(description: string): string {
  const withoutBrand = (description || "")
    .replace(/["“”'`]([^"“”'`]{2,})["“”'`]/g, " ") // "CAPPUCCINE"
    .replace(/\d+\s*[x×]\s*\d+(?:[.,]\d+)?/gi, " ") // 6X500
    .replace(/\(\s*[x×]\s*\d+\s*\)/gi, " ")         // (X10)
    .replace(/\d+\s*[/-]\s*\d+/g, " ")              // calibro 60/80
    .replace(/\d+(?:[.,]\d+)?\s*%/g, " ")           // 0%, 25%
    .replace(/\d+(?:[.,]\d+)?\s*(?:kg|gr?|hg|lt?|ml|cl|cc)\b/gi, " "); // 1,7 KG

  const words = stripAccents(withoutBrand.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0)
    .filter((t) => !/^\d+(?:[a-z]+|x\d+.*)?$/.test(t) || (/^\d+$/.test(t) && t.length <= 2))
    .filter((t) => !NOISE_TOKENS.has(t))
    // Single letters are the debris of "D/N", "V/V", "1P" — never real words.
    .filter((t) => t.length > 1);
  const cleaned = words.map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)));
  // Falling back to the raw description beats proposing an empty name.
  return (cleaned.join(" ") || (description || "").trim()).slice(0, 80);
}

/**
 * Match every invoice line against the warehouse. High-confidence matches are
 * safe to auto-apply; medium ones are pre-selected but flagged for review; the
 * rest come back with a ready "create this ingredient" proposal.
 */
export function suggestLineMatches(lines: LineToMatch[], ingredients: MatchCandidate[]): LineMatch[] {
  return lines.map((line) => {
    const kind = classifyLine(line.description);
    const derived = deriveLine({
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    });

    // A service or a delivery charge is not stock: never match it to an
    // ingredient, however well the words happen to score.
    if (kind !== "goods") {
      return {
        lineId: line.id,
        ingredientId: null,
        score: 0,
        confidence: "none" as const,
        proposal: { name: proposeName(line.description), unit: derived.unit },
        kind,
        derived,
      };
    }

    let best: MatchCandidate | null = null;
    let bestScore = 0;
    for (const ing of ingredients) {
      let s = matchScore(line.description, ing.name);
      // Compare in the unit the goods actually arrive in, not the supplier's
      // trade unit: a "CF" of clams is a kilo, and kilos are what the warehouse
      // row holds. Dampen rather than forbid — invoice units lie.
      if (!compatible(derived.unit, ing.unit)) s *= 0.85;
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
      proposal: { name: proposeName(line.description), unit: derived.unit },
      kind,
      derived,
    };
  });
}
