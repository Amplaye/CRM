// FIX B7 — Apology recovery (graceful failure + auto-recovery).
//
// Why: when the controller produces neither an aiText nor any actionable
// data (booking/modify/waitlist) the customer would otherwise see silence.
// Two behaviors:
//   (a) silent-stuck → send a warm fallback with the restaurant phone and
//       flag the phone so we know to apologize next turn.
//   (b) recovery → on the next successful turn, prepend an apology and
//       clear the flag.
//
// This is a pure decision-maker: the controller owns the per-phone failure
// flag (`_sd.botFailures[phone]`) and applies the returned decision.
//
// Source: openai.js (extracted) lines 1734-1778. Reply strings preserved
// verbatim from the live workflow.

import type { Lang } from '../types';

export interface ApologyRecoveryInput {
  /** The aiText the controller has computed so far (may be null) */
  aiText: string | null;
  hasBookingData: boolean;
  hasModifyData: boolean;
  hasWaitlistData: boolean;
  lang: Lang;
  /** Display-format restaurant phone, interpolated into the fallback */
  restaurantPhoneDisplay: string;
  /** True if `_sd.botFailures[phone]` was set on entry */
  hadPreviousFailure: boolean;
}

export type ApologyRecoveryDecision =
  | { kind: 'noop'; aiText: string | null }
  | { kind: 'silent_stuck'; aiText: string; setFailure: true }
  | { kind: 'recover'; aiText: string; clearFailure: true };

const FALLBACKS: Record<Lang, (phone: string) => string> = {
  es: (p) =>
    `Perdona, en este momento no consigo gestionar tu mensaje correctamente. Si te urge reservar, llama al ${p} y te atienden encantados. Estamos resolviendo el problema, vuelvo en cuanto pueda. ¡Gracias por la paciencia!`,
  it: (p) =>
    `Scusa, in questo momento non riesco a gestire bene il tuo messaggio. Se ti urge prenotare, chiama il ${p} e saranno felici di aiutarti. Stiamo risolvendo, torno appena posso. Grazie per la pazienza!`,
  en: (p) =>
    `Sorry, I can't process your message correctly right now. If you need to book urgently, call ${p} — they'll be happy to help. We're fixing this and I'll be right back. Thanks for your patience!`,
  de: (p) =>
    `Entschuldige, im Moment kann ich deine Nachricht nicht richtig bearbeiten. Wenn du dringend reservieren möchtest, ruf bitte ${p} an — sie helfen dir gerne. Wir beheben das Problem, ich bin gleich zurück. Danke für deine Geduld!`,
};

const APOLOGIES: Record<Lang, string> = {
  es: 'Perdona el silencio de antes, ya está todo resuelto.\n\n',
  it: 'Scusa il silenzio di prima, ora è tutto risolto.\n\n',
  en: "Sorry for the silence earlier, everything's sorted now.\n\n",
  de: 'Entschuldige die Stille zuvor, jetzt ist alles geregelt.\n\n',
};

/**
 * Decide which apology-recovery branch applies for this turn.
 *
 * The silent-stuck branch wins over recovery (a never-text turn re-flags
 * the failure even if a previous one was open).
 */
export function applyApologyRecovery(input: ApologyRecoveryInput): ApologyRecoveryDecision {
  const hasData = input.hasBookingData || input.hasModifyData || input.hasWaitlistData;
  const nothingToSend = !input.aiText && !hasData;
  const lang = input.lang;

  if (nothingToSend) {
    const make = FALLBACKS[lang] || FALLBACKS.es;
    return {
      kind: 'silent_stuck',
      aiText: make(input.restaurantPhoneDisplay),
      setFailure: true,
    };
  }

  if (input.hadPreviousFailure && (input.aiText || hasData)) {
    const apology = APOLOGIES[lang] || APOLOGIES.es;
    const aiText = input.aiText
      ? apology + input.aiText
      : apology.replace(/\s+$/, '');
    return { kind: 'recover', aiText, clearFailure: true };
  }

  return { kind: 'noop', aiText: input.aiText };
}
