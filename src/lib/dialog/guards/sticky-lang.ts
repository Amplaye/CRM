// Sticky language detection (FIX 2026-05-08).
//
// Why: customers code-switch. A German caller may write a Spanish-flavoured
// name like "Núñez" or borrow "gracias" mid-sentence; an Italian customer
// may say "ok" or "thanks" inside a reservation flow. Naïvely re-detecting
// language per turn flips the bot mid-conversation and breaks UX (replies
// half-Spanish, half-Italian).
//
// Algorithm:
//   1. Score the incoming message for STRONG markers — full words unique
//      to one language (e.g. "perché" → IT, "möchte" → DE, "thanks" → EN).
//      Single accented characters (ñ, ¿, ä, ß) are NOT strong markers
//      because foreign names routinely contain them.
//   2. If no strong markers, fall back to WEAK keyword phrases. Need ≥2
//      hits to declare a language.
//   3. Sticky rule: once a language is locked on the session, only flip
//      when the new message has ≥2 DISTINCT strong markers of a different
//      language.
//
// Source: fetch-history-plus-check-availability.js (extracted) lines
// 496-552. Patterns preserved verbatim.

import type { Lang } from '../types';

export interface DetectionResult {
  lang: Lang | null;
  strong: boolean;
  strongCount: number;
}

// Full-word strong markers, language-exclusive.
const ES_STRONG = /\b(qu[eé]|qui[eé]n|cu[aá]ndo|donde|ahora|modificar|cancelar|cambiar|personas|reserva|gracias|mañana|hola|buenos|buenas|quiero|quisiera|reservar|hoy|noche|tarde|cena|almuerzo|mesa|confirmo|cumpleaños|cumpleanos|vale|claro|perfecto)\b/gi;
const IT_STRONG = /\b(perch[eé]|però|già|più|poich[eé]|cos[ìi]|modificare|modifica|annulla|annullare|cancellare|cambiare|persone|prenotazione|tavolo|domani|stasera|grazie|ciao|buongiorno|buonasera|prenotare|sono|vorrei|stanotte|oggi|pranzo|gioved|venerd|sabato|domenica|luned|marted|mercoled|confermo|compleanno)\b/gi;
const EN_STRONG = /\b(the|and|you|your|please|thanks|thank|modify|cancel|change|booking|table|tomorrow|tonight|people|hello|hi|good\s+(?:morning|afternoon|evening)|reservation|book|today|dinner|lunch|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
const DE_STRONG = /\b(reservierung|reservieren|tisch|stornieren|absagen|ändern|aendern|möchte|moechte|hätte|haette|guten\s+(?:tag|abend|morgen)|danke|bitte|wir\s+sind|für\s+\d|fuer\s+\d|drinnen|draußen|draussen|innenbereich|außenbereich|aussenbereich|abendessen|mittagessen|personen|hallo|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|geburtstag|bestätigen|bestaetigen|uhr|heute)\b/gi;

// Weak keyword phrases — require ≥2 distinct hits to declare a language.
const ES_WEAK = [' por favor ', ' del ', ' los ', ' las ', ' qué ', ' que ', ' para ', ' con ', ' sí '];
const IT_WEAK = [' per favore ', ' scusi ', ' va bene ', ' vorremmo ', ' grazie mille '];
const EN_WEAK = [' good morning ', ' good afternoon ', ' good evening ', ' thank you '];
const DE_WEAK = [' guten ', ' tag ', ' abend ', ' morgen ', ' allergie ', ' kinder ', ' hund '];

function distinctCount(text: string, re: RegExp): number {
  const matches = text.match(re) || [];
  return new Set(matches.map((s) => s.toLowerCase().trim())).size;
}

/**
 * Pure detection of a message's likely language. Caller decides whether to
 * apply the result (sticky-lang policy lives in `applyStickyLang`).
 */
export function detectLang(message: string | null | undefined): DetectionResult {
  if (!message) return { lang: null, strong: false, strongCount: 0 };
  const padded = ' ' + message.toLowerCase() + ' ';

  const counts: Record<Lang, number> = {
    de: distinctCount(padded, DE_STRONG),
    it: distinctCount(padded, IT_STRONG),
    en: distinctCount(padded, EN_STRONG),
    es: distinctCount(padded, ES_STRONG),
  };

  // Pick the language with the highest distinct strong-marker count.
  let bestLang: Lang | null = null;
  let bestCount = 0;
  for (const k of ['de', 'it', 'en', 'es'] as const) {
    if (counts[k] > bestCount) {
      bestLang = k;
      bestCount = counts[k];
    }
  }
  if (bestCount > 0) {
    return { lang: bestLang, strong: true, strongCount: bestCount };
  }

  // Weak fallback: need ≥2 distinct keyword phrase hits.
  let esHits = 0, itHits = 0, enHits = 0, deHits = 0;
  for (const k of ES_WEAK) if (padded.includes(k)) esHits++;
  for (const k of IT_WEAK) if (padded.includes(k)) itHits++;
  for (const k of EN_WEAK) if (padded.includes(k)) enHits++;
  for (const k of DE_WEAK) if (padded.includes(k)) deHits++;

  const max = Math.max(esHits, itHits, enHits, deHits);
  if (max < 2) return { lang: null, strong: false, strongCount: 0 };
  if (deHits === max) return { lang: 'de', strong: false, strongCount: 0 };
  if (esHits === max) return { lang: 'es', strong: false, strongCount: 0 };
  if (itHits === max) return { lang: 'it', strong: false, strongCount: 0 };
  return { lang: 'en', strong: false, strongCount: 0 };
}

/**
 * Apply the sticky-lang policy: pick the language for THIS turn given the
 * previously-locked language and the current message.
 *
 * Rules:
 *  - No previous lock + detection found a language → adopt it.
 *  - Previous lock + same detection → keep lock.
 *  - Previous lock + DIFFERENT detection → flip ONLY when detection is
 *    strong with ≥2 distinct markers.
 *  - Previous lock + no detection → keep lock.
 *  - No lock + no detection → null (caller may default to a tenant fallback).
 */
export function applyStickyLang(
  previousLang: Lang | null,
  message: string,
): { lang: Lang | null; flipped: boolean; detection: DetectionResult } {
  const det = detectLang(message);

  if (!previousLang && det.lang) {
    return { lang: det.lang, flipped: true, detection: det };
  }
  if (
    previousLang &&
    det.lang &&
    det.lang !== previousLang &&
    det.strong &&
    det.strongCount >= 2
  ) {
    return { lang: det.lang, flipped: true, detection: det };
  }
  return { lang: previousLang, flipped: false, detection: det };
}
