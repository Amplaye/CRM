// PICNIC restaurant business rules
// Tables now have variable shapes and seat counts; the DB function
// atomic_book_tables decides which (and how many) tables to assign
// based on the party size. Constants below are kept only as fallback.

const TOTAL_TABLES = 13;
const SEATS_PER_TABLE = 4;

// Schedule: dayOfWeek 0=Sun, 1=Mon, 2=Tue, ...
// Mon(1): closed
// Tue(2), Wed(3): dinner only 19:30-22:30
// Thu(4): lunch 12:30-15:30, dinner 20:00-22:30
// Fri(5), Sat(6): lunch 12:30-15:30, dinner 19:30-22:30
// Sun(0): lunch only 12:30-15:30

interface ShiftSchedule {
  start: string;
  end: string;
}

const SCHEDULE: Record<number, { lunch?: ShiftSchedule; dinner?: ShiftSchedule }> = {
  0: { lunch: { start: '12:30', end: '15:30' } }, // Sun
  1: {}, // Mon closed
  2: { dinner: { start: '19:30', end: '22:30' } }, // Tue
  3: { dinner: { start: '19:30', end: '22:30' } }, // Wed
  4: { lunch: { start: '12:30', end: '15:30' }, dinner: { start: '20:00', end: '22:30' } }, // Thu
  5: { lunch: { start: '12:30', end: '15:30' }, dinner: { start: '19:30', end: '22:30' } }, // Fri
  6: { lunch: { start: '12:30', end: '15:30' }, dinner: { start: '19:30', end: '22:30' } }, // Sat
};

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

export function isOpen(dayOfWeek: number, shift: 'lunch' | 'dinner'): boolean {
  const day = SCHEDULE[dayOfWeek];
  if (!day) return false;
  return shift === 'lunch' ? !!day.lunch : !!day.dinner;
}

export function getBookingAction(partySize: number): 'auto_confirm' | 'manual_review' | 'reject' {
  if (partySize <= 6) return 'auto_confirm';
  if (partySize <= 12) return 'manual_review';
  return 'reject';
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function getTimeSlots(dayOfWeek: number): string[] {
  const day = SCHEDULE[dayOfWeek];
  if (!day) return [];

  const slots: string[] = [];

  const addSlots = (schedule: ShiftSchedule) => {
    const startMin = timeToMinutes(schedule.start);
    const endMin = timeToMinutes(schedule.end);
    for (let min = startMin; min <= endMin; min += 15) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  };

  if (day.lunch) addSlots(day.lunch);
  if (day.dinner) addSlots(day.dinner);

  return slots;
}

export { TOTAL_TABLES };
