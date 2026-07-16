import { describe, it, expect } from 'vitest';
import {
  getShift,
  getRotationMinutes,
  calculateEndTime,
  tablesNeeded,
  isOpen,
  getBookingAction,
  getTimeSlots,
  classifyHora,
  lastReservationTime,
  reservationOffsets,
  isAfterLastReservation,
  type OpeningHours,
  type TimeSlot,
} from './restaurant-rules';

describe('getShift', () => {
  it('classifies times before 16:00 as lunch', () => {
    expect(getShift('12:30')).toBe('lunch');
    expect(getShift('13:00')).toBe('lunch');
    expect(getShift('15:59')).toBe('lunch');
  });
  it('classifies 16:00 and later as dinner', () => {
    expect(getShift('16:00')).toBe('dinner');
    expect(getShift('20:00')).toBe('dinner');
    expect(getShift('23:30')).toBe('dinner');
  });
  it('classifies post-midnight small hours as dinner (after-midnight close)', () => {
    expect(getShift('00:00')).toBe('dinner');
    expect(getShift('00:15')).toBe('dinner');
    expect(getShift('01:00')).toBe('dinner');
  });
});

describe('getRotationMinutes', () => {
  it('always 120 min for parties of 7+ regardless of shift/day', () => {
    expect(getRotationMinutes(7, 'lunch', 0)).toBe(120);
    expect(getRotationMinutes(10, 'dinner', 5)).toBe(120);
    expect(getRotationMinutes(12, 'lunch', 3)).toBe(120);
  });
  it('lunch shift is 75 min for small parties', () => {
    expect(getRotationMinutes(1, 'lunch', 1)).toBe(75);
    expect(getRotationMinutes(6, 'lunch', 6)).toBe(75);
  });
  it('dinner Tue/Wed/Thu is 90 min', () => {
    expect(getRotationMinutes(2, 'dinner', 2)).toBe(90);
    expect(getRotationMinutes(4, 'dinner', 3)).toBe(90);
    expect(getRotationMinutes(6, 'dinner', 4)).toBe(90);
  });
  it('dinner Fri/Sat is 105 min (busiest evenings)', () => {
    expect(getRotationMinutes(4, 'dinner', 5)).toBe(105);
    expect(getRotationMinutes(2, 'dinner', 6)).toBe(105);
  });
});

describe('calculateEndTime', () => {
  it('adds rotation minutes inside the same hour', () => {
    expect(calculateEndTime('20:00', 90)).toBe('21:30');
    expect(calculateEndTime('13:00', 75)).toBe('14:15');
  });
  it('handles crossing the midnight boundary modulo 24', () => {
    expect(calculateEndTime('23:30', 90)).toBe('01:00');
  });
  it('pads zeros in HH:MM output', () => {
    expect(calculateEndTime('09:05', 30)).toBe('09:35');
  });
});

describe('tablesNeeded', () => {
  it('ceils to 4 seats per table', () => {
    expect(tablesNeeded(1)).toBe(1);
    expect(tablesNeeded(4)).toBe(1);
    expect(tablesNeeded(5)).toBe(2);
    expect(tablesNeeded(8)).toBe(2);
    expect(tablesNeeded(9)).toBe(3);
    expect(tablesNeeded(12)).toBe(3);
  });
});

describe('getBookingAction', () => {
  // Defaults (no policy) reproduce the old hardcoded 7/13 behaviour.
  it('1–6 auto-confirm (default)', () => {
    for (let n = 1; n <= 6; n++) expect(getBookingAction(n)).toBe('auto_confirm');
  });
  it('7–12 manual review (default)', () => {
    for (let n = 7; n <= 12; n++) expect(getBookingAction(n)).toBe('manual_review');
  });
  it('13+ rejected (default)', () => {
    expect(getBookingAction(13)).toBe('reject');
    expect(getBookingAction(50)).toBe('reject');
  });

  // Per-tenant policy: an owner who auto-confirms up to 18 (large=19, block=25).
  it('honours a high per-tenant threshold (large=19, block=25)', () => {
    const opts = { largeThreshold: 19, blockThreshold: 25 };
    expect(getBookingAction(18, opts)).toBe('auto_confirm'); // at the limit → auto
    expect(getBookingAction(19, opts)).toBe('manual_review'); // first size that escalates
    expect(getBookingAction(24, opts)).toBe('manual_review');
    expect(getBookingAction(25, opts)).toBe('reject'); // block ceiling
  });

  // Boundary: the threshold IS the first size that needs review (strict <).
  it('threshold boundary is exclusive (large=7 → 6 auto, 7 review)', () => {
    expect(getBookingAction(6, { largeThreshold: 7, blockThreshold: 13 })).toBe('auto_confirm');
    expect(getBookingAction(7, { largeThreshold: 7, blockThreshold: 13 })).toBe('manual_review');
  });
});

const PICNIC_HOURS: OpeningHours = {
  '0': [{ open: '13:00', close: '16:00' }],                                  // Sun lunch only
  '1': [],                                                                    // Mon closed
  '2': [{ open: '20:00', close: '23:30' }],                                  // Tue dinner only
  '3': [{ open: '20:00', close: '23:30' }],                                  // Wed dinner only
  '4': [{ open: '13:00', close: '16:00' }, { open: '20:00', close: '23:30' }], // Thu both
  '5': [{ open: '13:00', close: '16:00' }, { open: '20:00', close: '23:30' }], // Fri both
  '6': [{ open: '13:00', close: '16:00' }, { open: '20:00', close: '23:30' }], // Sat both
};

describe('isOpen', () => {
  it('Sunday lunch open, dinner closed', () => {
    expect(isOpen(0, 'lunch', PICNIC_HOURS)).toBe(true);
    expect(isOpen(0, 'dinner', PICNIC_HOURS)).toBe(false);
  });
  it('Monday fully closed', () => {
    expect(isOpen(1, 'lunch', PICNIC_HOURS)).toBe(false);
    expect(isOpen(1, 'dinner', PICNIC_HOURS)).toBe(false);
  });
  it('Tuesday/Wednesday dinner only', () => {
    expect(isOpen(2, 'lunch', PICNIC_HOURS)).toBe(false);
    expect(isOpen(2, 'dinner', PICNIC_HOURS)).toBe(true);
    expect(isOpen(3, 'dinner', PICNIC_HOURS)).toBe(true);
  });
  it('Thursday–Saturday lunch + dinner', () => {
    for (const dow of [4, 5, 6]) {
      expect(isOpen(dow, 'lunch', PICNIC_HOURS)).toBe(true);
      expect(isOpen(dow, 'dinner', PICNIC_HOURS)).toBe(true);
    }
  });
});

// Oraz live schedule: Fri dinner runs 19:30–00:00, Sat 19:30–01:00 (closes after
// midnight). Mirrors tenant.settings.opening_hours for the after-midnight regression.
const AFTER_MIDNIGHT_HOURS: OpeningHours = {
  '5': [{ open: '12:30', close: '15:30' }, { open: '19:30', close: '00:00' }], // Fri
  '6': [{ open: '12:30', close: '15:30' }, { open: '19:30', close: '01:00' }], // Sat
};

describe('getTimeSlots', () => {
  it('returns empty for closed days', () => {
    expect(getTimeSlots(1, PICNIC_HOURS)).toEqual([]);
  });
  it('produces 15-min slots inside opening hours', () => {
    const sun = getTimeSlots(0, PICNIC_HOURS);
    expect(sun[0]).toBe('13:00');
    expect(sun[1]).toBe('13:15');
    expect(sun[sun.length - 1]).toBe('16:00');
  });
  it('covers both shifts on Thursday', () => {
    const thu = getTimeSlots(4, PICNIC_HOURS);
    expect(thu).toContain('13:00');
    expect(thu).toContain('15:45');
    expect(thu).toContain('20:00');
    expect(thu).toContain('23:30');
    // No gap-fill — 16:00 lunch close to 20:00 dinner open should NOT include 16:15–19:45
    expect(thu).not.toContain('17:00');
    expect(thu).not.toContain('19:00');
  });
  // After-midnight close: dinner that ends at 00:00 / 01:00 must still produce slots.
  // Regression — the loop used to never run (1170 <= 0), wiping the whole dinner service.
  it('generates dinner slots when dinner closes at midnight (00:00)', () => {
    const fri = getTimeSlots(5, AFTER_MIDNIGHT_HOURS); // 19:30–00:00
    expect(fri).toContain('19:30');
    expect(fri).toContain('21:00');
    expect(fri).toContain('23:45');
    expect(fri).toContain('00:00');
    expect(fri).not.toContain('01:00');
  });
  it('generates dinner slots past midnight when dinner closes at 01:00', () => {
    const sat = getTimeSlots(6, AFTER_MIDNIGHT_HOURS); // 19:30–01:00
    expect(sat).toContain('23:45');
    expect(sat).toContain('00:00');
    expect(sat).toContain('00:15');
    expect(sat).toContain('01:00');
  });
});

// Live Picnic schedule used by the chatbot: Tuesday has dinner-only 19:30-22:30,
// with last reservation at 21:45 (close - 45min). 19:00 is BETWEEN shifts, not
// past last-reservation — must classify as before_next_opening, not after_last.
const PICNIC_LIVE: OpeningHours = {
  '0': [{ open: '12:30', close: '15:30' }, { open: '19:30', close: '22:30' }],
  '1': [],
  '2': [{ open: '12:30', close: '15:00' }, { open: '19:30', close: '22:30' }],
  '3': [{ open: '12:30', close: '15:30' }, { open: '19:30', close: '22:30' }],
  '4': [{ open: '12:30', close: '15:30' }, { open: '20:00', close: '22:30' }],
  '5': [{ open: '12:30', close: '15:30' }, { open: '19:30', close: '22:30' }],
  '6': [{ open: '12:30', close: '15:30' }, { open: '19:30', close: '22:30' }],
};

describe('classifyHora', () => {
  it('19:00 on Tuesday is between shifts → before_next_opening 19:30', () => {
    expect(classifyHora('19:00', 2, PICNIC_LIVE)).toEqual({ kind: 'before_next_opening', nextOpen: '19:30' });
  });
  it('22:00 on Tuesday is past last reservation 21:45 → after_last_reservation', () => {
    expect(classifyHora('22:00', 2, PICNIC_LIVE)).toEqual({ kind: 'after_last_reservation', lastReservation: '21:45' });
  });
  it('20:00 on Tuesday is inside dinner range', () => {
    expect(classifyHora('20:00', 2, PICNIC_LIVE)).toEqual({ kind: 'in_range' });
  });
  it('12:00 on Tuesday is before lunch opens → before_next_opening 12:30', () => {
    expect(classifyHora('12:00', 2, PICNIC_LIVE)).toEqual({ kind: 'before_next_opening', nextOpen: '12:30' });
  });
  it('16:00 on Thursday (between lunch and dinner) → before_next_opening 20:00', () => {
    expect(classifyHora('16:00', 4, PICNIC_LIVE)).toEqual({ kind: 'before_next_opening', nextOpen: '20:00' });
  });
  it('Monday closed → closed_day', () => {
    expect(classifyHora('20:00', 1, PICNIC_LIVE)).toEqual({ kind: 'closed_day' });
  });
  // After-midnight close (Fri dinner 19:30–00:00): last reservation = 00:00 − 45 = 23:15.
  it('Friday 21:00 with dinner closing at midnight is in_range', () => {
    expect(classifyHora('21:00', 5, AFTER_MIDNIGHT_HOURS)).toEqual({ kind: 'in_range' });
  });
  it('Friday 23:45 is past last reservation (23:15) → after_last_reservation', () => {
    expect(classifyHora('23:45', 5, AFTER_MIDNIGHT_HOURS)).toEqual({ kind: 'after_last_reservation', lastReservation: '23:15' });
  });
  it('Saturday last reservation crosses midnight (01:00 − 45 = 00:15)', () => {
    expect(classifyHora('00:30', 6, AFTER_MIDNIGHT_HOURS)).toEqual({ kind: 'after_last_reservation', lastReservation: '00:15' });
    expect(classifyHora('00:00', 6, AFTER_MIDNIGHT_HOURS)).toEqual({ kind: 'in_range' });
  });
});

describe('reservationOffsets', () => {
  it('falls back to legacy 45/60 when unset', () => {
    expect(reservationOffsets(undefined)).toEqual({ lunch: 45, dinner: 60 });
    expect(reservationOffsets(null)).toEqual({ lunch: 45, dinner: 60 });
    expect(reservationOffsets({})).toEqual({ lunch: 45, dinner: 60 });
  });
  it('uses owner values including 0', () => {
    expect(reservationOffsets({ lunch: 30, dinner: 90 })).toEqual({ lunch: 30, dinner: 90 });
    expect(reservationOffsets({ lunch: 0, dinner: 0 })).toEqual({ lunch: 0, dinner: 0 });
  });
});

describe('lastReservationTime', () => {
  const LUNCH_DINNER: TimeSlot[] = [
    { open: '13:00', close: '16:00' },
    { open: '20:00', close: '23:30' },
  ];
  it('close − offset per shift', () => {
    expect(lastReservationTime(LUNCH_DINNER, 'lunch', 45)).toBe('15:15');
    expect(lastReservationTime(LUNCH_DINNER, 'dinner', 60)).toBe('22:30');
  });
  it('dinner closing after midnight does not collapse onto open', () => {
    const afterMidnight: TimeSlot[] = [{ open: '19:30', close: '00:00' }];
    // 00:00 → 24:00; 24:00 − 45 = 23:15
    expect(lastReservationTime(afterMidnight, 'dinner', 45)).toBe('23:15');
    const oneAm: TimeSlot[] = [{ open: '19:30', close: '01:00' }];
    // 01:00 → 25:00; 25:00 − 45 = 00:15
    expect(lastReservationTime(oneAm, 'dinner', 45)).toBe('00:15');
  });
  it('negative offset = shift not served → null', () => {
    expect(lastReservationTime(LUNCH_DINNER, 'lunch', -1)).toBeNull();
  });
  it('offset larger than the shift never precedes the open', () => {
    // 16:00 − 600min would be 06:00; clamps to the 13:00 open.
    expect(lastReservationTime(LUNCH_DINNER, 'lunch', 600)).toBe('13:00');
  });
});

describe('isAfterLastReservation', () => {
  const LUNCH_DINNER: TimeSlot[] = [
    { open: '13:00', close: '16:00' },
    { open: '20:00', close: '23:30' },
  ];
  const offsets = { lunch: 45, dinner: 60 }; // last lunch 15:15, last dinner 22:30
  it('is false at or before the cut-off, true after', () => {
    expect(isAfterLastReservation('15:15', LUNCH_DINNER, offsets)).toBe(false);
    expect(isAfterLastReservation('15:00', LUNCH_DINNER, offsets)).toBe(false);
    expect(isAfterLastReservation('15:30', LUNCH_DINNER, offsets)).toBe(true);
    expect(isAfterLastReservation('22:30', LUNCH_DINNER, offsets)).toBe(false);
    expect(isAfterLastReservation('23:15', LUNCH_DINNER, offsets)).toBe(true); // the bug: 23:15 close-adjacent slot is not bookable
  });
  it('handles after-midnight dinner: 00:30 is later than a 00:15 cut-off', () => {
    const oneAm: TimeSlot[] = [{ open: '19:30', close: '01:00' }]; // last dinner 00:15
    const o = { lunch: 45, dinner: 45 };
    expect(isAfterLastReservation('00:15', oneAm, o)).toBe(false);
    expect(isAfterLastReservation('00:30', oneAm, o)).toBe(true);
    expect(isAfterLastReservation('23:00', oneAm, o)).toBe(false);
  });
  it('no cut-off (shift not served) → never after', () => {
    const dinnerOnly: TimeSlot[] = [{ open: '20:00', close: '23:30' }];
    expect(isAfterLastReservation('14:00', dinnerOnly, { lunch: -1, dinner: 60 })).toBe(false);
  });
});

