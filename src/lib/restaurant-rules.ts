// Restaurant business rules.
// Schedule/opening_hours is the single source of truth — stored in
// tenant.settings.opening_hours and also exposed to bots via a
// "Horario del restaurante" KB article. Nothing here is hardcoded
// per-tenant anymore.

const SEATS_PER_TABLE = 4;

export interface TimeSlot { open: string; close: string }
export type OpeningHours = Record<string, TimeSlot[]>;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function getShift(time: string): 'lunch' | 'dinner' {
  const [h, m] = time.split(':').map(Number);
  const minutes = h * 60 + m;
  // Small hours (00:00–04:59) belong to the previous evening's dinner service
  // for venues whose dinner closes after midnight (e.g. 19:30–00:00 / 19:30–01:00).
  // No venue serves lunch at this hour, so this is purely a correctness fix.
  if (minutes < 300) return 'dinner';
  // lunch: before 16:00 (960min), dinner: 16:00+
  return minutes < 960 ? 'lunch' : 'dinner';
}

export function getRotationMinutes(partySize: number, shift: 'lunch' | 'dinner', dayOfWeek: number): number {
  if (partySize >= 7) return 120;
  if (shift === 'lunch') return 75;
  // dinner
  if (dayOfWeek === 5 || dayOfWeek === 6) return 105; // Fri, Sat
  return 90; // Tue, Wed, Thu
}

export function calculateEndTime(time: string, rotationMinutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMin = h * 60 + m + rotationMinutes;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

export function tablesNeeded(partySize: number): number {
  return Math.ceil(partySize / SEATS_PER_TABLE);
}

export function isOpen(dayOfWeek: number, shift: 'lunch' | 'dinner', openingHours: OpeningHours): boolean {
  const daySlots = openingHours[String(dayOfWeek)] || [];
  return daySlots.some(s => {
    const startMin = timeToMinutes(s.open);
    const isLunch = startMin < 960;
    return shift === 'lunch' ? isLunch : !isLunch;
  });
}

function minutesToTime(min: number): string {
  const t = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// Last accepted reservation time for a shift = shift close − offset (minutes the
// owner picked in the setup wizard, stored in settings.last_reservation_offset).
// A guest can book AT this time but not after it: a 23:45 slot when the kitchen
// closes at 00:00 is not a real table. `offset < 0` means the shift isn't served
// → no cut-off (returns null). Shared by /api/ai/availability (to hide late
// slots) and /api/ai/book (to reject them). Mirrors getTimeSlots' midnight-wrap.
export function lastReservationTime(
  daySlots: TimeSlot[],
  shift: 'lunch' | 'dinner',
  offset: number,
): string | null {
  if (offset < 0) return null;
  for (const s of daySlots) {
    const startMin = timeToMinutes(s.open);
    if ((shift === 'lunch' && startMin < 17 * 60) || (shift === 'dinner' && startMin >= 17 * 60)) {
      let closeMin = timeToMinutes(s.close);
      // Dinner closing after midnight (00:00 / 01:00) wraps to a small number;
      // push past 24h so "close − offset" doesn't go negative and collapse onto
      // the open time (e.g. 00:00 − 45 → 23:15, not a bogus 23:15 before open).
      if (closeMin <= startMin) closeMin += 24 * 60;
      return minutesToTime(Math.max(startMin, closeMin - offset));
    }
  }
  return null;
}

// The two per-shift offsets a tenant configured (setup wizard), with the legacy
// 45/60-minute fallback for tenants provisioned before the field existed.
export function reservationOffsets(
  raw: { lunch?: number; dinner?: number } | null | undefined,
): { lunch: number; dinner: number } {
  const o = raw || {};
  return {
    lunch: Number.isFinite(o.lunch) ? (o.lunch as number) : 45,
    dinner: Number.isFinite(o.dinner) ? (o.dinner as number) : 60,
  };
}

// Is `time` after the last accepted reservation for its shift? Used to drop
// too-late slots and to reject too-late booking attempts. False when the shift
// has no cut-off. Handles after-midnight dinner (00:30 is "later" than 23:00).
export function isAfterLastReservation(
  time: string,
  daySlots: TimeSlot[],
  offsets: { lunch: number; dinner: number },
): boolean {
  const shift = getShift(time);
  const last = lastReservationTime(daySlots, shift, offsets[shift]);
  if (!last) return false;
  let reqMin = timeToMinutes(time);
  let lastMin = timeToMinutes(last);
  // After-midnight tail of a dinner service: shift both into the 24h+ range so
  // 00:30 compares as later than 23:00, and a 00:15 cut-off sits above 23:45.
  const startMin = daySlots.length ? Math.min(...daySlots.map((s) => timeToMinutes(s.open))) : 0;
  if (shift === 'dinner') {
    if (reqMin < startMin) reqMin += 24 * 60;
    if (lastMin < startMin) lastMin += 24 * 60;
  }
  return reqMin > lastMin;
}

// Decide what happens to a booking of `partySize`, given the tenant's policy.
// - largeThreshold = first party size that needs manual confirmation (escalated)
// - blockThreshold = first party size refused outright
// These map 1:1 to settings.bot_config.party_size_threshold_large /
// party_size_block_threshold (see BookingPolicy in onboarding/kb-generator.ts).
// The defaults (7 / 13) reproduce the old hardcoded "<=6 auto / <=12 review / >12
// reject" behaviour for callers/tenants that don't supply a policy.
export function getBookingAction(
  partySize: number,
  opts?: { largeThreshold?: number; blockThreshold?: number },
): 'auto_confirm' | 'manual_review' | 'reject' {
  const large = opts?.largeThreshold ?? 7;
  const block = opts?.blockThreshold ?? 13;
  if (partySize < large) return 'auto_confirm';
  if (partySize < block) return 'manual_review';
  return 'reject';
}

// Classify an asked time against the day's shifts.
// "before_next_opening" = the time falls in the gap between shifts (or before the
// first shift) and the next shift hasn't started yet — propose its opening time.
// "after_last_reservation" = the time is past close-minus-cutoff of the last
// shift that could still seat it — propose the closest last-reservation slot.
// "in_range" = the time fits within [open, close - cutoffMinutes] of some shift.
export type HoraClassification =
  | { kind: 'in_range' }
  | { kind: 'before_next_opening'; nextOpen: string }
  | { kind: 'after_last_reservation'; lastReservation: string }
  | { kind: 'closed_day' };

export function classifyHora(
  askedTime: string,
  dayOfWeek: number,
  openingHours: OpeningHours,
  cutoffMinutes = 45,
): HoraClassification {
  const slots = openingHours[String(dayOfWeek)] || [];
  if (slots.length === 0) return { kind: 'closed_day' };
  let askedMin = timeToMinutes(askedTime);
  // Normalize shifts that close after midnight (close <= open → push past 24h),
  // so the in-range / last-reservation math doesn't collapse (e.g. 19:30–00:00).
  const ranges = slots.map(s => {
    const open = timeToMinutes(s.open);
    let close = timeToMinutes(s.close);
    if (close <= open) close += 24 * 60;
    return { open, close, openStr: s.open, closeStr: s.close };
  });
  // A small-hours asked time (e.g. 00:15) belongs to a midnight-crossing dinner,
  // so compare it on the same normalized timeline.
  const crossesMidnight = ranges.some(r => r.close > 24 * 60);
  if (crossesMidnight && askedMin < 5 * 60) askedMin += 24 * 60;
  const inRange = ranges.some(r => askedMin >= r.open && askedMin <= r.close - cutoffMinutes);
  if (inRange) return { kind: 'in_range' };
  const nextOpening = ranges
    .filter(r => r.open > askedMin)
    .sort((a, b) => a.open - b.open)[0];
  if (nextOpening) return { kind: 'before_next_opening', nextOpen: nextOpening.openStr };
  const lasts = ranges.map(r => r.close - cutoffMinutes).filter(v => Number.isFinite(v));
  const bestLast = lasts.length ? Math.max(...lasts) : null;
  const bestLastNorm = bestLast != null ? ((bestLast % (24 * 60)) + 24 * 60) % (24 * 60) : null;
  const hh = bestLastNorm != null ? String(Math.floor(bestLastNorm / 60)).padStart(2, '0') : null;
  const mm = bestLastNorm != null ? String(bestLastNorm % 60).padStart(2, '0') : null;
  return { kind: 'after_last_reservation', lastReservation: hh && mm ? `${hh}:${mm}` : '' };
}

export function getTimeSlots(dayOfWeek: number, openingHours: OpeningHours): string[] {
  const daySlots = openingHours[String(dayOfWeek)] || [];
  const slots: string[] = [];

  for (const slot of daySlots) {
    const startMin = timeToMinutes(slot.open);
    let endMin = timeToMinutes(slot.close);
    // Shift that closes after midnight (e.g. 19:30–00:00 or 19:30–01:00): the
    // close minute wraps to a small number (0 / 60), so push it past 24h. Without
    // this the loop never runs and the ENTIRE dinner service vanishes from the
    // availability array — the bot then wrongly tells clients there's no dinner.
    if (endMin <= startMin) endMin += 24 * 60;
    for (let min = startMin; min <= endMin; min += 15) {
      const t = min % (24 * 60);
      const h = Math.floor(t / 60);
      const m = t % 60;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }

  return slots;
}

// Localized label for canonical zone slugs ('inside' / 'outside').
// Custom zones (e.g. 'Terraza') are returned untouched.
export function zoneLabel(zone: string, t: (key: any) => string): string {
  if (zone === 'inside') return t('zone_inside');
  if (zone === 'outside') return t('zone_outside');
  return zone;
}
