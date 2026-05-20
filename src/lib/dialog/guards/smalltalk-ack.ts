// FIX B31 — Smalltalk / acknowledgment detector.
//
// Why: after a successful modify (or a quiet moment), the user often sends
// "vale gracias" / "genial" / "grazie" / "thanks" / "danke". Without this
// branch the controller re-uses the just-modified fields, rebuilds
// modifyData and re-sends the "Reserva modificada" card on every ack.
// This guard catches pure ack messages and replies conversationally,
// resetting session.fields and marking intent='info'.
//
// Detection rules:
//  - Lowercase + strip punctuation + collapse whitespace.
//  - Token set size in [1, 5].
//  - Every token must be in the multilingual ack vocabulary OR the small
//    filler list (y, e, und, and, …).
//  - Parser must not have extracted any actionable field.
//  - Controller must not be in a mid-flight context (proposed*, disambig,
//    editingPending, pending=notas_ask, or any pendingBooking/Waitlist).
//
// Source: openai.js (extracted) lines 740-802. Vocabulary, filler list and
// reply pools preserved verbatim from the live workflow.

import type { Lang, ParserOutput, PendingState, DialogSession } from '../types';

export interface SmalltalkAckContext {
  proposedZone: 'interior' | 'exterior' | null;
  proposedDate: string | null;
  proposedHora: string | null;
  awaitingDisambig: boolean;
  editingPending: boolean;
  pending: PendingState;
  hasPendingBooking: boolean;
  hasPendingWaitlist: boolean;
}

export interface SmalltalkAckInput {
  message: string;
  lang: Lang;
  parsed: ParserOutput;
  context: SmalltalkAckContext;
  /** Optional RNG for deterministic tests; defaults to Math.random */
  rng?: () => number;
}

export type SmalltalkAckDecision =
  | { fired: false }
  | { fired: true; reply: string; sessionPatch: Partial<DialogSession> };

const ACK_WORDS = new Set<string>([
  // Spanish
  'vale', 'ok', 'okay', 'okey', 'okok', 'gracias', 'muchas', 'muchísimas', 'muchisimas',
  'mil', 'perfecto', 'perfecta', 'genial', 'estupendo', 'súper', 'super', 'dale', 'listo',
  'bueno', 'buena', 'bien', 'de', 'nada', 'chévere', 'guay', 'molaria', 'molaría', 'fenomenal',
  // Italian
  'grazie', 'grazies', 'perfetto', 'perfetta', 'ottimo', 'ottima', 'benissimo', 'bene', 'va',
  'd’accordo', 'daccordo', 'dacc', 'okk', 'mille', 'figata', 'prego',
  // English
  'thanks', 'thank', 'you', 'thx', 'ty', 'great', 'perfect', 'awesome', 'cool', 'nice',
  'good', 'fine', 'alright', 'sure', 'sounds', 'sweet', 'cheers', 'brilliant', 'lovely',
  'excellent',
  // German
  'danke', 'dankeschön', 'dankeschon', 'vielen', 'dank', 'perfekt', 'super', 'prima',
  'klasse', 'toll', 'sehr', 'gut', 'schön', 'schon', 'passt', 'alles', 'klar',
  'wunderbar', 'geil',
]);

const FILLER_WORDS = new Set<string>([
  'y', 'e', 'und', 'and', 'o', 'a', 'la', 'el', 'it', 'un', 'una', 'de', 'di',
]);

const REPLIES: Record<Lang, string[]> = {
  es: [
    '¡De nada! Que disfrutes mucho.',
    '¡Un placer! Hasta pronto.',
    'A ti, ¡buen provecho!',
    '¡Encantado de ayudarte!',
  ],
  it: [
    'Di niente! Buon appetito.',
    'È stato un piacere! A presto.',
    'Grazie a te! Buon appetito.',
    'Volentieri! A presto.',
  ],
  en: [
    'You’re welcome! Enjoy.',
    'My pleasure! See you soon.',
    'Glad to help! Enjoy your meal.',
    'Anytime! See you soon.',
  ],
  de: [
    'Gern geschehen! Guten Appetit.',
    'War mir eine Freude! Bis bald.',
    'Sehr gerne! Bis bald.',
    'Immer wieder gerne!',
  ],
};

const PUNCT_RE = /[¡¿!?.,;:()\[\]{}'"`*~\-_]/g;

function normalizeTokens(raw: string): Set<string> {
  const cleaned = (raw || '')
    .trim()
    .toLowerCase()
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return new Set();
  return new Set(cleaned.split(' ').filter(Boolean));
}

function parsedHasField(p: ParserOutput): boolean {
  return !!(
    p.personas ||
    p.delta_personas ||
    p.fecha ||
    p.hora ||
    p.zona ||
    p.nombre ||
    p.notas
  );
}

function contextUnsafe(c: SmalltalkAckContext): boolean {
  return !!(
    c.proposedZone ||
    c.proposedDate ||
    c.proposedHora ||
    c.awaitingDisambig ||
    c.editingPending ||
    c.pending === 'notas_ask' ||
    c.hasPendingBooking ||
    c.hasPendingWaitlist
  );
}

/**
 * Decide whether the incoming message is a pure ack and (if so) produce
 * a localized conversational reply plus the session reset patch. The
 * caller merges the patch before persisting; `lastModifyTarget` is
 * intentionally NOT touched so a follow-up real modify can still skip
 * disambig.
 */
export function applySmalltalkAck(input: SmalltalkAckInput): SmalltalkAckDecision {
  const tokens = normalizeTokens(input.message);
  if (tokens.size === 0 || tokens.size > 5) return { fired: false };

  for (const t of tokens) {
    if (!ACK_WORDS.has(t) && !FILLER_WORDS.has(t)) return { fired: false };
  }

  if (parsedHasField(input.parsed)) return { fired: false };
  if (contextUnsafe(input.context)) return { fired: false };

  const pool = REPLIES[input.lang] || REPLIES.es;
  const rng = input.rng ?? Math.random;
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const reply = pool[idx];

  const sessionPatch: Partial<DialogSession> = {
    intent: 'info',
    lastInstructionTopic: null,
    fields: {
      personas: null,
      fecha: null,
      hora: null,
      zona: null,
      nombre: null,
      notas: null,
      notas_asked: false,
      availability_checked: false,
    },
  };

  return { fired: true, reply, sessionPatch };
}
