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
    return reqMin >= oh * 60 + om && reqMin <= ch * 60 + cm;
  });
  if (inAnySlot) return { ok: true };
  return {
    ok: false,
    reason: 'outside_hours',
    hoursToday: hoursToday.map((s) => `${s.open}-${s.close}`).join(', '),
  };
}
