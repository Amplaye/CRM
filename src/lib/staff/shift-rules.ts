// Pure rota rules (no I/O) — shared by the /api/staff routes and unit-tested.
// A shift is (member, date, band, start_time, end_time). end <= start means it
// crosses midnight (dinner 19:00–01:00), so overlap math works on a 48h line.

export type ShiftBand = "lunch" | "dinner" | "all";

export interface ShiftSpan {
  start_time: string; // "HH:MM" or "HH:MM:SS"
  end_time: string;
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
