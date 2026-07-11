// Pure rota rules (no I/O) — shared by the /api/staff routes and unit-tested.
// A shift is (member, date, band, start_time, end_time). end <= start means it
// crosses midnight (dinner 19:00–01:00), so overlap math works on a 48h line.

export type ShiftBand = "lunch" | "dinner" | "all";

// Why a member is off. Only meaningful on a time_off request; swaps/legacy = null.
export type AbsenceKind = "vacation" | "sick" | "personal" | "other";
export const ABSENCE_KINDS: readonly AbsenceKind[] = ["vacation", "sick", "personal", "other"];

export interface ShiftSpan {
  start_time: string; // "HH:MM" or "HH:MM:SS"
  end_time: string;
}

/** Default start/end for a band — two taps schedule a standard shift. Single
 *  source of truth shared by the modal, the bulk tool and any future caller. */
export function bandPreset(band: ShiftBand): { start_time: string; end_time: string } {
  if (band === "lunch") return { start_time: "12:00", end_time: "16:00" };
  if (band === "dinner") return { start_time: "19:00", end_time: "23:30" };
  return { start_time: "12:00", end_time: "23:30" }; // all
}

export interface ShiftLike extends ShiftSpan {
  id?: string;
  member_id: string;
  work_date: string; // YYYY-MM-DD
  status?: string;
}

export function timeToMin(t: string): number {
  const [h = "0", m = "0"] = String(t).split(":");
  const hh = parseInt(h, 10);
  const mm = parseInt(m, 10);
  return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
}

/** Normalize a span onto minutes; an end at/before the start rolls past midnight. */
function span(s: ShiftSpan): [number, number] {
  const a = timeToMin(s.start_time);
  let b = timeToMin(s.end_time);
  if (b <= a) b += 24 * 60;
  return [a, b];
}

export function isValidTime(t: unknown): t is string {
  return typeof t === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(t);
}

export function isValidDate(d: unknown): d is string {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/** True when two same-day spans overlap (midnight-crossing handled). */
export function spansOverlap(a: ShiftSpan, b: ShiftSpan): boolean {
  const [a1, a2] = span(a);
  const [b1, b2] = span(b);
  return a1 < b2 && b1 < a2;
}

/**
 * First scheduled shift of the SAME member on the SAME date whose hours
 * overlap the candidate — or null. Cancelled rows never conflict; when the
 * candidate carries an id (edit), the row itself is skipped.
 */
export function findConflict<T extends ShiftLike>(existing: T[], candidate: ShiftLike): T | null {
  for (const s of existing) {
    if (candidate.id && s.id === candidate.id) continue;
    if (s.status === "cancelled") continue;
    if (s.member_id !== candidate.member_id) continue;
    if (s.work_date !== candidate.work_date) continue;
    if (spansOverlap(s, candidate)) return s;
  }
  return null;
}

/** Validate a create/edit payload; returns an error code or null when fine. */
export function validateShiftInput(input: {
  work_date?: unknown;
  band?: unknown;
  start_time?: unknown;
  end_time?: unknown;
}): string | null {
  if (!isValidDate(input.work_date)) return "invalid_date";
  if (input.band !== "lunch" && input.band !== "dinner" && input.band !== "all") return "invalid_band";
  if (!isValidTime(input.start_time) || !isValidTime(input.end_time)) return "invalid_time";
  const [a, b] = span({ start_time: input.start_time as string, end_time: input.end_time as string });
  if (b - a < 15) return "too_short"; // sub-15-minute shifts are input mistakes
  if (b - a > 16 * 60) return "too_long"; // >16h can't be one shift
  return null;
}

// ── Date maths for the bulk rota tool & multi-day absences ──────────────────
// All pure string maths on "YYYY-MM-DD" so the same logic runs on the client
// (grid preview) and the server (the write), with no timezone drift from Date.

const MS_DAY = 24 * 60 * 60 * 1000;

/** Parse "YYYY-MM-DD" as a UTC instant (avoids local-tz off-by-one). */
function ymdToUtc(d: string): number {
  const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
  return Date.UTC(y, (m || 1) - 1, day || 1);
}

function utcToYmd(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Monday=0 … Sunday=6 for a "YYYY-MM-DD" date. */
export function weekdayIndex(d: string): number {
  return (new Date(ymdToUtc(d)).getUTCDay() + 6) % 7;
}

/** Add `n` days to a "YYYY-MM-DD" date, returning "YYYY-MM-DD". */
export function addDays(d: string, n: number): string {
  return utcToYmd(ymdToUtc(d) + n * MS_DAY);
}

/**
 * Every date in [from, to] inclusive, ascending. Empty if `to` < `from` or
 * either is malformed. Capped at 366 days so a typo can't fan out unbounded.
 */
export function datesInRange(from: string, to: string): string[] {
  if (!isValidDate(from) || !isValidDate(to)) return [];
  const a = ymdToUtc(from);
  const b = ymdToUtc(to);
  if (b < a) return [];
  const out: string[] = [];
  for (let ms = a; ms <= b && out.length < 366; ms += MS_DAY) out.push(utcToYmd(ms));
  return out;
}

/**
 * Given the Monday that starts a week and a set of weekday indices
 * (0=Mon … 6=Sun), return the concrete dates in that week, ascending.
 */
export function weekdayDatesInWeek(weekStart: string, weekdays: number[]): string[] {
  if (!isValidDate(weekStart)) return [];
  const want = new Set(weekdays.filter((n) => n >= 0 && n <= 6));
  const out: string[] = [];
  for (let i = 0; i < 7; i++) if (want.has(i)) out.push(addDays(weekStart, i));
  return out;
}
