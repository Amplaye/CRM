// FIX B32 — Off-topic guardrail.
//
// Why: the chatbot must not engage with chitchat, politics, religion, jokes,
// flirting, bot tests ("are you a robot?"), or any topic unrelated to
// restaurant reservations / menu / address / hours. The voice agent has the
// same rule (mirror this behavior across channels).
//
// Behavior: send ONE fixed reply in the customer's language and reset the
// session so the next turn starts cleanly if the customer returns with a
// real booking intent. Never echo the off-topic content.
//
// Source: openai.js (extracted) lines 1124-1143.

import type { Lang, DialogSession } from '../types';

const OFFTOPIC_REPLY: Record<Lang, string> = {
  es: 'Disculpa, aquí solo puedo ayudarte con la reserva o con información del restaurante (menú, horarios, dirección). Dime en qué te ayudo.',
  it: 'Scusa, qui posso aiutarti solo con la prenotazione o con informazioni sul ristorante (menu, orari, indirizzo). Dimmi pure in cosa posso aiutarti.',
  en: "Sorry, here I can only help with reservations or restaurant info (menu, hours, address). Tell me how I can help.",
  de: 'Entschuldigung, hier kann ich nur bei Reservierungen oder Restaurantinfos (Speisekarte, Öffnungszeiten, Adresse) helfen. Sag mir, wobei ich dir helfen kann.',
};

export type OfftopicDecision =
  | { fired: false }
  | { fired: true; reply: string; sessionResetPatch: Partial<DialogSession> };

/**
 * If the parser flagged the message as off-topic, return the canned reply
 * and a session reset patch the controller must merge before persisting.
 *
 * The reset clears `fields`, `intent`, `lastInstructionTopic`,
 * `lastModifyAttempt` so the customer can come back fresh.
 */
export function applyOfftopicGuard(session: Pick<DialogSession, 'intent' | 'lang'>): OfftopicDecision {
  if (session.intent !== 'offtopic') return { fired: false };
  const reply = OFFTOPIC_REPLY[session.lang] || OFFTOPIC_REPLY.es;

  const sessionResetPatch: Partial<DialogSession> = {
    intent: null,
    lastInstructionTopic: null,
    lastModifyAttempt: null,
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

  return { fired: true, reply, sessionResetPatch };
}

/** Exposed for callers that want to render the reply themselves. */
export function getOfftopicReply(lang: Lang): string {
  return OFFTOPIC_REPLY[lang] || OFFTOPIC_REPLY.es;
}
