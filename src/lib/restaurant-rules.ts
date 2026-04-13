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

export function getBookingAction(partySize: number): 'auto_confirm' | 'manual_review' | 'reject' {
  if (partySize <= 6) return 'auto_confirm';
  if (partySize <= 12) return 'manual_review';
  return 'reject';
}

export function getTimeSlots(dayOfWeek: number, openingHours: OpeningHours): string[] {
  const daySlots = openingHours[String(dayOfWeek)] || [];
  const slots: string[] = [];

  for (const slot of daySlots) {
    const startMin = timeToMinutes(slot.open);
    const endMin = timeToMinutes(slot.close);
    for (let min = startMin; min <= endMin; min += 15) {
      const h = Math.floor(min / 60);
      const m = min % 60;
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
