// Pure validation + opening-hours helpers used by /api/ai/book and
// /api/ai/modify. Extracted to allow unit testing the rules in isolation
// from the Supabase calls and side effects of the route handlers.
//
// Nothing in here touches the network, the clock, or the DB. Time-aware
// helpers accept an explicit `nowInTz` argument so tests can pin time.

import type { OpeningHours } from './restaurant-rules';

const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^\d{2}:\d{2}$/;
// E.164 — optional leading '+', first digit 1–9, total 7–15 digits.
export const PHONE_E164_RE = /^\+?[1-9]\d{6,14}$/;

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s);
}

export function isTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function isE164(phone: unknown): boolean {
  if (typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  return trimmed.length > 0 && PHONE_E164_RE.test(trimmed);
}

// Pragmatic email check: one "@", a dotted domain with a 2+ letter TLD, no
// spaces. Not RFC-perfect (that's a losing game) — the goal is to reject "asd",
// "a@b", "test@test" while accepting real addresses. Applied to the web booking
// widget where the email is captured for marketing (must be a plausible inbox).
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_RE.test(trimmed);
}

/** Trim + lowercase for storage; '' for empty/garbage so callers can skip it. */
export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') return '';
  const trimmed = email.trim().toLowerCase();
  return isEmail(trimmed) ? trimmed : '';
}

/**
 * Canonical phone form for STORING a guest, idempotent regardless of how the
 * channel delivered it. Under Meta WhatsApp the inbound `from` arrives WITHOUT
 * a leading "+" (e.g. "34684109244"); under Twilio it was "whatsapp:+34…".
 * Both refer to the same person but used to create two separate `guests` rows.
 *
 * Strips a "whatsapp:" prefix and every non-digit, then prepends a single "+".
 * The country code is NEVER guessed: inbound WhatsApp numbers always include it
 * (that is how WhatsApp routes), so the digits are already E.164 minus the "+".
 * Returns "" for empty/garbage input so callers can keep their no-phone path.
 */
export function normalizePhone(phone: unknown): string {
  if (phone === null || phone === undefined) return '';
  const digits = String(phone).replace(/^whatsapp:/i, '').replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

/**
 * Last 9 digits (E.164 subscriber part) used for a TOLERANT guest lookup that
 * matches an existing row whether it was stored with or without the leading
 * "+". Mirrors the deterministic tail-match already used in cancel-by-phone /
 * confirm-pending. Returns "" when there are too few digits to match safely.
 */
export function phoneTail(phone: unknown): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-9) : '';
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Find the next open day starting from `fromDate` (exclusive).
 * Returns null if no opening hours within `maxLookahead` days.
 */
export function findNextOpenDay(
  openingHours: OpeningHours,
  fromDate: string,
  maxLookahead = 7
): { date: string; weekday: string } | null {
  const base = new Date(fromDate + 'T12:00:00');
  for (let i = 1; i <= maxLookahead; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const dow = d.getDay();
    const slots = openingHours[String(dow)] || [];
    if (slots.length > 0) {
      return { date: d.toISOString().slice(0, 10), weekday: WEEKDAYS_ES[dow] };
    }
  }
  return null;
}

/**
 * Normalize a free-text zone preference to canonical 'inside' | 'outside' | null.
 * Accepts ES/IT/EN/DE variants and common synonyms.
 */
export function normalizeZone(z: unknown): 'inside' | 'outside' | null {
  if (!z || typeof z !== 'string') return null;
  const v = z.toLowerCase().trim();
  if (v.includes('inside') || v.includes('interior') || v.includes('dentro') || v.includes('interno') || v.includes('drinnen') || v.includes('innen')) return 'inside';
  if (v.includes('outside') || v.includes('exterior') || v.includes('fuera') || v.includes('terraza') || v.includes('terrazza') || v.includes('outdoor') || v.includes('draußen') || v.includes('draussen') || v === 'out') return 'outside';
  return null;
}

/**
 * The exact set allowed by the DB check constraint `reservations_source_check`.
 * Keep this in sync with the migration if the constraint ever changes.
 */
export type BookingSource = 'ai_chat' | 'ai_voice' | 'staff' | 'web' | 'walk_in';

/**
 * Map any caller-supplied `source` to a value the `reservations_source_check`
 * constraint accepts. n8n/Vapi bypass our TypeScript types and have sent values
 * the DB rejects (e.g. the voice workflow posts `voice_spontaneous`), which made
 * the INSERT fail with `reservations_source_check` and surfaced as a critical
 * `booking:service` error. Normalising here — at the API boundary — fixes the
 * present bug and inoculates against any future caller that invents a label.
 */
export function normalizeBookingSource(s: unknown, fallback: BookingSource = 'ai_voice'): BookingSource {
  if (typeof s !== 'string') return fallback;
  const v = s.toLowerCase().trim();
  if (v === 'ai_chat' || v === 'ai_voice' || v === 'staff' || v === 'web' || v === 'walk_in') return v;
  // Synonyms / legacy labels from external callers. Order matters: match the
  // walk-in spellings before the looser chat/voice substring checks.
  if (v === 'walk-in' || v === 'walkin') return 'walk_in';
  if (v === 'online') return 'web';
  if (v.includes('voice') || v === 'phone' || v === 'ai_agent') return 'ai_voice';
  if (v.includes('chat') || v.includes('whatsapp')) return 'ai_chat';
  return fallback;
}

/**
 * Returns YYYY-MM-DD + a clock-time HH:MM for the Atlantic/Canary timezone.
 * Pulled out so tests can substitute a fixed Date.
 */
export function nowInCanary(now: Date = new Date()): { todayYmd: string; hours: number; minutes: number } {
  const canaryNow = new Date(now.toLocaleString('en-US', { timeZone: 'Atlantic/Canary' }));
  const todayYmd =
    canaryNow.getFullYear() +
    '-' +
    String(canaryNow.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(canaryNow.getDate()).padStart(2, '0');
  return { todayYmd, hours: canaryNow.getHours(), minutes: canaryNow.getMinutes() };
}

/**
 * @returns 'past_date' if `date` is strictly before `todayYmd`,
 *          'past_time' if same-day and `time` ≤ current clock,
 *          null otherwise. `time` ignored when `date` is in the past.
 */
export function checkPast(
  date: string,
  time: string,
  todayYmd: string,
  nowHours: number,
  nowMinutes: number
): 'past_date' | 'past_time' | null {
  if (date < todayYmd) return 'past_date';
  if (date !== todayYmd) return null;
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const reqMin = h * 60 + m;
  const nowMin = nowHours * 60 + nowMinutes;
  return reqMin <= nowMin ? 'past_time' : null;
}

export type OpeningHoursResult =
  | { ok: true }
  | { ok: false; reason: 'closed_day'; nextOpen: { date: string; weekday: string } | null }
  | { ok: false; reason: 'outside_hours'; hoursToday: string };

/**
 * Verify the requested (date, time) falls inside the tenant's opening hours.
 * Returns a structured result; callers turn this into HTTP responses.
 */
export function checkOpeningHours(
  date: string,
  time: string,
  openingHours: OpeningHours
): OpeningHoursResult {
  const dow = new Date(date + 'T12:00:00').getDay();
  const hoursToday = openingHours[String(dow)] || [];
  if (hoursToday.length === 0) {
    return { ok: false, reason: 'closed_day', nextOpen: findNextOpenDay(openingHours, date) };
  }
  const [rh, rm] = time.split(':').map(Number);
  const reqMin = rh * 60 + rm;
  const inAnySlot = hoursToday.some((s) => {
    const [oh, om] = s.open.split(':').map(Number);
    const [ch, cm] = s.close.split(':').map(Number);
    const openMin = oh * 60 + om;
    let closeMin = ch * 60 + cm;
    // A close at/before the open belongs to the next day (e.g. open 19:30, close
    // 00:30). Without this, 00:30 parses to 30 min and every valid evening time
    // (22:30 > 30) is wrongly rejected as outside_hours. Shift the request into the
    // after-midnight tail when it falls before the open of a midnight-crossing slot.
    if (closeMin <= openMin) closeMin += 24 * 60;
    const rq = reqMin < openMin && closeMin > 24 * 60 ? reqMin + 24 * 60 : reqMin;
    return rq >= openMin && rq <= closeMin;
  });
  if (inAnySlot) return { ok: true };
  return {
    ok: false,
    reason: 'outside_hours',
    hoursToday: hoursToday.map((s) => `${s.open}-${s.close}`).join(', '),
  };
}
