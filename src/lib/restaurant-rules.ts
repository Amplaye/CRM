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
