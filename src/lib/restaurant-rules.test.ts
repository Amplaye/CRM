import { describe, it, expect } from 'vitest';
import {
  getShift,
  getRotationMinutes,
  calculateEndTime,
  tablesNeeded,
  isOpen,
  getBookingAction,
  getTimeSlots,
  type OpeningHours,
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
  it('1–6 auto-confirm', () => {
    for (let n = 1; n <= 6; n++) expect(getBookingAction(n)).toBe('auto_confirm');
  });
  it('7–12 manual review', () => {
    for (let n = 7; n <= 12; n++) expect(getBookingAction(n)).toBe('manual_review');
  });
  it('13+ rejected', () => {
    expect(getBookingAction(13)).toBe('reject');
    expect(getBookingAction(50)).toBe('reject');
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
});
