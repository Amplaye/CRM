// FIX B34 — Empty-modify guard.
//
// Why: the parser may emit `intent: 'modify'` (or 'cancel') from a vague
// reply like "ho cambiato idea" or "modificalo" — but if the customer has
// NO active reservation, treating it as modify produces a "qué quieres
// cambiar?" loop. The guard rewrites the intent to 'book' so the bot
// gracefully starts the booking flow instead.
//
// Source: openai.js (extracted snapshot) line ~1823 + state-machine
// reinforcement 2026-05-12.

import type { ParserOutput } from '../types';

export interface ExistingReservation {
  id: string;
  fecha: string;
  hora: string;
  personas: number;
}

/**
 * Pure function. Returns a (possibly new) ParserOutput with intent rewritten
 * if the guard fires. The original object is not mutated.
 *
 * @returns `{ result, fired }` — `fired` is true when we rewrote, useful for
 *          telemetry and tests.
 */
export function applyEmptyModifyGuard(
  extracted: ParserOutput,
  existingReservations: ExistingReservation[] | null | undefined,
): { result: ParserOutput; fired: boolean } {
  const isModifyOrCancel =
    extracted.intent === 'modify' || extracted.intent === 'cancel';
  const noReservations =
    !existingReservations || existingReservations.length === 0;

  if (isModifyOrCancel && noReservations) {
    return {
      result: { ...extracted, intent: 'book' },
      fired: true,
    };
  }
  return { result: extracted, fired: false };
}
