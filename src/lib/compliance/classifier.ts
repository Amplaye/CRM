// Real-time Tier 0 / Tier 1 classifier — decides, on an inbound guest message,
// whether it contains SENSITIVE personal data (GDPR Art. 9 / revFADP "besonders
// schützenswerte Personendaten") that triggers the just-in-time consent flow and
// separate storage, or only ORDINARY data that flows under service-delivery basis.
//
// Tier 0 (ordinary): name, phone, party size, date/time, kids, pets → no friction.
// Tier 1 (sensitive): health/allergy/dietary-medical + accessibility → explicit,
//   logged consent required.
//
// This is intentionally a fast, dependency-free keyword/stem matcher (NOT an LLM
// call): it runs inline on every inbound message across ES/IT/DE/EN, so it must be
// cheap and deterministic. The design bias is DELIBERATELY over-inclusive on Tier 1
// — a false positive merely triggers a one-tap "ok to save this?" micro-consent
// (which reads as care), whereas a false negative would mean processing health data
// WITHOUT the legally required consent. Over-flag, never under-flag.
//
// Known limitation: an allergy stated without a cue word (e.g. "I can't eat
// shellfish" with no "allergy"/"intolerant") may slip through the stems. We catch
// the common allergen nouns too, but the LLM-side prompt should still surface an
// explicit allergy question when in doubt. This layer is the floor, not the ceiling.

/** The sensitive (Tier 1) categories we detect. */
export type SensitiveCategory = "health" | "accessibility";

export interface Classification {
  /** 0 = ordinary personal data, 1 = sensitive (special-category) data. */
  tier: 0 | 1;
  /** Which sensitive categories were detected (empty for Tier 0). */
  categories: SensitiveCategory[];
  /** The normalized stems that matched, for the consent log / debugging. */
  matches: string[];
}

/** Strip diacritics + lowercase so "alérgico", "Zöliakie", "mobilità" all match a
 * plain-ASCII stem list. NFD splits accented chars into base + combining mark;
 * the combining-mark range is then removed. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Sensitive stems per category, keyed to normalized (accent-free) text and matched
 * as substrings. Grouped by language for maintainability but matched together. Each
 * stem is chosen to be as specific as possible while covering ES/IT/DE/EN forms. */
const SENSITIVE_STEMS: Record<SensitiveCategory, string[]> = {
  health: [
    // allergy / allergic — ES "alerg", IT/DE/EN "allerg"
    "alerg", "allerg",
    // intolerance — ES/EN "intoler", IT "intoller", DE "vertraglich" (unverträglich)
    "intoler", "intoller", "vertraglich",
    // celiac / coeliac / Zöliakie
    "celiac", "coeliac", "zoliakie",
    // common dietary-medical triggers
    "gluten", "lactos", "lattos", "laktos",
    // conditions
    "diabet", "asma", "asthma", "epileps",
    // pregnancy — ES "embaraz", IT "incinta"/"gravidanz", DE "schwanger", EN "pregnan"
    "embaraz", "incinta", "gravidanz", "schwanger", "pregnan",
    // allergen nouns often stated without a cue word
    "shellfish", "marisco", "crostacei", "frutti di mare",
    "peanut", "cacahuete", "arachidi", "erdnuss",
    "frutos secos", "frutta a guscio",
  ],
  accessibility: [
    // wheelchair — ES "silla de rueda", IT "rotelle", DE "rollstuhl", EN "wheelchair"
    "silla de rueda", "rotelle", "rollstuhl", "wheelchair",
    // reduced mobility
    "movilidad reducida", "mobilita ridotta", "reduced mobility", "gehbehind", "eingeschrank",
    // disability
    "discapacid", "disabil", "disab", "behinder",
    // step-free / accessible access
    "barrierefrei", "accesib", "accessib", "step-free", "step free",
    "rampa", "rampe", "ramp ",
  ],
};

/**
 * Classify a piece of inbound text as Tier 0 (ordinary) or Tier 1 (sensitive).
 *
 * Multilingual (ES/IT/DE/EN) and case/accent-insensitive. Returns which sensitive
 * categories matched and the stems that fired, so the consent log can record the
 * exact `data_category`. A blank/whitespace input is Tier 0 with no matches.
 */
export function classifyText(text: string | null | undefined): Classification {
  if (!text || !text.trim()) return { tier: 0, categories: [], matches: [] };
  const norm = normalize(text);

  const categories: SensitiveCategory[] = [];
  const matches: string[] = [];

  (Object.keys(SENSITIVE_STEMS) as SensitiveCategory[]).forEach((cat) => {
    const hit = SENSITIVE_STEMS[cat].filter((stem) => norm.includes(stem));
    if (hit.length) {
      categories.push(cat);
      matches.push(...hit);
    }
  });

  return {
    tier: categories.length ? 1 : 0,
    categories,
    matches,
  };
}

/** Convenience: does this text contain any sensitive (Tier 1) data? */
export function isSensitive(text: string | null | undefined): boolean {
  return classifyText(text).tier === 1;
}
