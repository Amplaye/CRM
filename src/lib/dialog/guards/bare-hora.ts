// FIX B38 / B38b — Bare-number hora interpretation.
//
// Why: the parser is context-blind. When the bot just asked "¿a qué hora?",
// the customer often replies with a bare number like "13" / "9" / "1015".
// The parser sometimes mis-classifies these as `personas` (rule "numero
// nudo") or `fecha` (rule "el día N"). This guard:
//  - reclassifies the bare number as `hora` when topic = 'hora'
//  - reclassifies as `personas` when topic = 'personas'
//  - clears the parser's wrong-field placements (B38b) so they don't poison
//    the session state.
//
// Special cases:
//  - 13..23 are accepted as 24h-format hours directly (FIX B38)
//  - 1..11 are treated as PM (add 12)
//  - 12 stays as 12:00 (noon)
//  - "somos diez" / "siamo cinque" / "we are 4" — strip leading prefix
//    before parsing.
//
// Source: openai.js (extracted) lines 692-737. Word dictionary preserved
// verbatim from the live workflow (ES/IT/EN, 1-20).

import type { ParserOutput } from '../types';

const PREFIX_STRIP_RE = /^\s*(somos|seremos|siamo|saremo|we'?re|we are|por|para|per)\s+/i;
const DIGIT_ONLY_RE = /^[^0-9a-zà-ÿ]*([0-9]{1,2})[^0-9a-zà-ÿ]*$/i;

const WORD_NUMS: Record<string, number> = {
  // Spanish 1-20 (includes feminine "una" and accented "dieciséis")
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14,
  quince: 15, dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20,
  // Italian 2-20 (no "uno" — overlaps with Spanish; that's fine, same value)
  due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9,
  dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15,
  sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19, venti: 20,
  // English 1-20
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

/** Topic the controller asked about last turn — only `personas` / `hora` matter for this guard */
export type BareHoraTopic = 'personas' | 'hora' | null;

/**
 * Extract a bare 1-30 number from a short message. Matches:
 *  - digit-only (with optional surrounding punctuation)
 *  - single word in ES/IT/EN 1-20
 *  - prefixed forms like "somos 4" / "siamo cinque" / "we are 6"
 * Returns null if no clean number can be extracted.
 */
export function extractBareNumber(message: string): number | null {
  if (!message) return null;
  const raw = message.trim().toLowerCase();
  if (!raw) return null;

  // Pure digit with optional leading/trailing punctuation/emoji
  const digitMatch = raw.match(DIGIT_ONLY_RE);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    return n >= 1 && n <= 30 ? n : null;
  }

  // Single-word number
  if (WORD_NUMS[raw] != null) return WORD_NUMS[raw];

  // Strip prefix and retry
  const stripped = raw.replace(PREFIX_STRIP_RE, '');
  if (stripped !== raw) {
    if (WORD_NUMS[stripped] != null) return WORD_NUMS[stripped];
    if (/^[0-9]{1,2}$/.test(stripped)) {
      const n = parseInt(stripped, 10);
      return n >= 1 && n <= 30 ? n : null;
    }
  }

  return null;
}

/**
 * Apply the FIX B38 / B38b reinterpretation to the parser output. The
 * session's `lastInstructionTopic` is the controller-supplied context.
 * Returns a new ParserOutput; the original is not mutated.
 */
export function applyBareHoraGuard(
  extracted: ParserOutput,
  message: string,
  topic: BareHoraTopic,
): { result: ParserOutput; fired: boolean } {
  const bareN = extractBareNumber(message);
  if (bareN == null) return { result: extracted, fired: false };

  // topic = 'personas' → fill personas only if parser didn't already.
  if (topic === 'personas') {
    if (extracted.personas != null) return { result: extracted, fired: false };
    return { result: { ...extracted, personas: bareN }, fired: true };
  }

  // topic = 'hora' → map to HH:00
  if (topic === 'hora') {
    if (extracted.hora != null) return { result: extracted, fired: false };
    const h =
      bareN === 12 ? 12 : bareN >= 1 && bareN <= 11 ? bareN + 12 : bareN >= 13 && bareN <= 23 ? bareN : null;
    if (h == null) return { result: extracted, fired: false };
    const hora = String(h).padStart(2, '0') + ':00';

    // FIX B38b — clear the parser's mis-classifications when they exactly
    // match the bare number (the same integer was wrongly placed in
    // `personas` or `fecha`).
    const result: ParserOutput = { ...extracted, hora };
    if (result.personas === bareN) result.personas = null;
    if (
      result.fecha &&
      result.fecha.endsWith('-' + String(bareN).padStart(2, '0'))
    ) {
      result.fecha = null;
    }
    return { result, fired: true };
  }

  return { result: extracted, fired: false };
}
