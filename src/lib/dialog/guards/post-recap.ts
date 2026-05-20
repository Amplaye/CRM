// FIX B41 — Post-recap guard.
//
// Why: after the bot has sent a booking recap card and is awaiting the
// customer's CONFIRMO, the customer may instead:
//  - ask an off-topic question ("dove siete?", "horarios?")
//  - send chitchat
//  - reply with something that the parser flags as `info` or empty
// The previous behavior would restart the booking flow asking
// "¿para cuántas personas?" — the customer got confused (Giacomo
// 2026-05-13, audit 4ad717ef). This guard detects the post-recap state
// and steers the bot to gently remind the customer of the
// CONFIRMO/MODIFICAR/CANCELAR options instead.
//
// Source: openai.js (extracted) lines 1145-1173.

import type { Lang, DialogSession } from '../types';

/** Multilingual reminder shown when the customer is in post-recap state */
const RECAP_HINT: Record<Lang, string> = {
  es: 'Recuerda al cliente que ya tiene una reserva pendiente de confirmación: para confirmarla responde *CONFIRMO*, para modificarla *MODIFICAR*, para cancelarla *CANCELAR*.',
  it: 'Ricorda al cliente che ha già una prenotazione in attesa di conferma: per confermarla rispondi *CONFERMO*, per modificarla *MODIFICA*, per annullarla *ANNULLA*.',
  en: 'Remind the client they already have a booking pending confirmation: to confirm reply *CONFIRM*, to modify reply *MODIFY*, to cancel reply *CANCEL*.',
  de: 'Erinnere den Kunden, dass eine Reservierung zur Bestätigung aussteht: zum Bestätigen antworte *BESTÄTIGEN*, zum Ändern *ÄNDERN*, zum Stornieren *STORNIEREN*.',
};

export type PostRecapDecision =
  | { fired: false }
  | { fired: true; nextInstruction: string; lastInstructionTopic: 'awaiting_confirmo' | null };

/**
 * Decide the next-instruction when the customer is in post-recap state.
 * "Post-recap" = the recap card was sent (a pendingBooking or
 * pendingWaitlist exists) and we're now awaiting CONFIRMO.
 *
 * Inputs that the controller passes in:
 *  - `hasPending` — true if pendingBookings[phone] or pendingWaitlist[phone] exists
 *  - `session.intent` — the parser-resolved intent for this turn
 *  - `session.fields` — currently-collected booking slots
 *  - `session.lang` — sticky language
 *
 * Returns:
 *  - `fired: false` when this guard does NOT apply (controller continues normally)
 *  - `fired: true` with the canned `nextInstruction` the formatter must follow
 */
export function applyPostRecapGuard(args: {
  hasPending: boolean;
  session: Pick<DialogSession, 'intent' | 'fields' | 'lang' | '_infoOverlay'>;
}): PostRecapDecision {
  const { hasPending, session } = args;
  const hint = RECAP_HINT[session.lang] || RECAP_HINT.es;

  if (session.intent === 'info') {
    const nextInstruction = hasPending
      ? 'Responde brevemente a la pregunta del cliente usando la base de conocimiento. Una o dos frases. ' + hint
      : 'Responde brevemente a la pregunta del cliente usando la base de conocimiento. Una o dos frases. Después, en la MISMA respuesta, retoma el flujo donde estaba si el cliente estaba en medio de una reserva (recuerda los datos ya dados).';
    return { fired: true, nextInstruction, lastInstructionTopic: null };
  }

  const fieldsEmpty =
    !session.fields.personas && !session.fields.fecha && !session.fields.hora;

  if (session.intent === 'book' && hasPending && fieldsEmpty) {
    return {
      fired: true,
      nextInstruction: hint,
      lastInstructionTopic: 'awaiting_confirmo',
    };
  }

  return { fired: false };
}

/** Exposed for tests + reuse by other components that show the same reminder */
export function getRecapHint(lang: Lang): string {
  return RECAP_HINT[lang] || RECAP_HINT.es;
}
