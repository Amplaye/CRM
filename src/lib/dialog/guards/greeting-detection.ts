// FIX B27 — Greeting-only detector.
//
// Why: when there is no active session intent, the controller normally tries
// to "recover" a pending booking/waitlist (so the customer can resume after
// the bot crashed mid-flow). But if the inbound message is JUST a greeting
// ("hola", "ciao", "hi", "buenas tardes" …), recovering is wrong — the
// customer is starting over, not continuing. Without this guard the bot
// re-emits the old recap or triggers a duplicate-book retry.
//
// Source: openai.js (extracted) lines 524-532. Same regex preserved verbatim.

// Two tweaks over the original n8n regex:
//  - allow leading punctuation/whitespace (e.g. "¡hola!", " hi")
//  - match italian "buon(a) (giorno|sera)" — the original `buon\s*sera` missed
//    "buonasera" because the joining "a" isn't whitespace.
const GREETING_RE = /^[\s¡¿]*(hola|hi|hey|hello|ciao|salve|buon(?:a)?\s*(?:giorno|sera|d[ií]a)|buenas|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|saludos|good\s+(?:morning|afternoon|evening))[\s!.\?¡¿]*$/i;

/**
 * True if the entire message is just a greeting (in any of the 4 supported
 * languages). Trims whitespace; case-insensitive; trailing punctuation OK.
 */
export function isGreetingOnly(message: string | null | undefined): boolean {
  if (!message) return false;
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return false;
  return GREETING_RE.test(trimmed);
}
