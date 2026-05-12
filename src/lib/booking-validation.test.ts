import { describe, it, expect } from 'vitest';
import {
  isDate,
  isTime,
  isE164,
  timeToMinutes,
  findNextOpenDay,
  normalizeZone,
  checkPast,
  checkOpeningHours,
} from './booking-validation';
import type { OpeningHours } from './restaurant-rules';

describe('isDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isDate('2026-05-12')).toBe(true);
    expect(isDate('1999-01-01')).toBe(true);
  });
  it('rejects malformed', () => {
    expect(isDate('2026/05/12')).toBe(false);
    expect(isDate('26-05-12')).toBe(false);
    expect(isDate('')).toBe(false);
    expect(isDate(undefined)).toBe(false);
    expect(isDate(20260512)).toBe(false);
  });
});

describe('isTime', () => {
  it('accepts HH:MM with leading zeros', () => {
    expect(isTime('09:05')).toBe(true);
    expect(isTime('23:59')).toBe(true);
    expect(isTime('00:00')).toBe(true);
  });
  it('rejects malformed', () => {
    expect(isTime('9:05')).toBe(false);
    expect(isTime('20:5')).toBe(false);
    expect(isTime('1015')).toBe(false);
    expect(isTime(null)).toBe(false);
  });
});

describe('isE164', () => {
  it('accepts with + prefix', () => {
    expect(isE164('+34612345678')).toBe(true);
    expect(isE164('+393331234567')).toBe(true);
  });
  it('accepts without + prefix', () => {
    expect(isE164('34612345678')).toBe(true);
  });
  it('rejects too short / leading zero / non-digits', () => {
    expect(isE164('+34123')).toBe(false);
    expect(isE164('+0123456789')).toBe(false);
    expect(isE164('not-a-phone')).toBe(false);
    expect(isE164('')).toBe(false);
    expect(isE164(undefined)).toBe(false);
  });
});

describe('timeToMinutes', () => {
  it('00:00 → 0', () => expect(timeToMinutes('00:00')).toBe(0));
  it('12:30 → 750', () => expect(timeToMinutes('12:30')).toBe(750));
  it('23:59 → 1439', () => expect(timeToMinutes('23:59')).toBe(1439));
});

describe('normalizeZone', () => {
  it('inside synonyms', () => {
    expect(normalizeZone('inside')).toBe('inside');
    expect(normalizeZone('interior')).toBe('inside');
    expect(normalizeZone('dentro')).toBe('inside');
    expect(normalizeZone('drinnen')).toBe('inside');
    expect(normalizeZone('Interno')).toBe('inside');
  });
  it('outside synonyms', () => {
    expect(normalizeZone('outside')).toBe('outside');
    expect(normalizeZone('exterior')).toBe('outside');
    expect(normalizeZone('terraza')).toBe('outside');
    expect(normalizeZone('terrazza')).toBe('outside');
    expect(normalizeZone('draußen')).toBe('outside');
    expect(normalizeZone('OUTDOOR')).toBe('outside');
    expect(normalizeZone('out')).toBe('outside');
  });
  it('returns null for unknown / empty', () => {
    expect(normalizeZone('rooftop')).toBe(null);
    expect(normalizeZone('')).toBe(null);
    expect(normalizeZone(null)).toBe(null);
    expect(normalizeZone(123)).toBe(null);
  });
});

const HOURS_FULL_WEEK: OpeningHours = {
  '0': [{ open: '13:00', close: '16:00' }],
  '1': [],
  '2': [{ open: '20:00', close: '23:30' }],
  '3': [{ open: '20:00', close: '23:30' }],
  '4': [{ open: '13:00', close: '16:00' }, { open: '20:00', close: '23:30' }],
  '5': [{ open: '13:00', close: '16:00' }, { open: '20:00', close: '23:30' }],
  '6': [{ open: '13:00', close: '16:00' }, { open: '20:00', close: '23:30' }],
};

describe('findNextOpenDay', () => {
  it('skips Monday closure', () => {
    // 2026-05-10 is a Sunday → next open should be Tuesday 2026-05-12
    const next = findNextOpenDay(HOURS_FULL_WEEK, '2026-05-10');
    expect(next?.date).toBe('2026-05-12');
    expect(next?.weekday).toBe('martes');
  });
  it('returns null if everything closed in window', () => {
    const closed: OpeningHours = { '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [] };
    expect(findNextOpenDay(closed, '2026-05-10', 3)).toBe(null);
  });
  it('respects maxLookahead', () => {
    const onlyFar: OpeningHours = { ...HOURS_FULL_WEEK, '0': [], '1': [], '2': [], '3': [], '4': [], '5': [], '6': [{ open: '13:00', close: '16:00' }] };
    // From a Sunday, Saturday is 6 days away → within default 7 lookahead
    expect(findNextOpenDay(onlyFar, '2026-05-10', 6)?.weekday).toBe('sábado');
    // But with lookahead 2 it should not reach it
    expect(findNextOpenDay(onlyFar, '2026-05-10', 2)).toBe(null);
  });
});

describe('checkPast', () => {
  it('past date returns past_date', () => {
    expect(checkPast('2026-05-11', '20:00', '2026-05-12', 14, 0)).toBe('past_date');
  });
  it('future date returns null', () => {
    expect(checkPast('2026-05-13', '20:00', '2026-05-12', 23, 50)).toBe(null);
  });
  it('today + already-passed time → past_time', () => {
    expect(checkPast('2026-05-12', '13:00', '2026-05-12', 15, 0)).toBe('past_time');
  });
  it('today + same minute → past_time (inclusive)', () => {
    expect(checkPast('2026-05-12', '14:30', '2026-05-12', 14, 30)).toBe('past_time');
  });
  it('today + future time → null', () => {
    expect(checkPast('2026-05-12', '20:00', '2026-05-12', 14, 30)).toBe(null);
  });
  it('malformed time → null (defensive)', () => {
    expect(checkPast('2026-05-12', 'oops', '2026-05-12', 14, 30)).toBe(null);
  });
});

describe('checkOpeningHours', () => {
  it('OK inside lunch slot', () => {
    expect(checkOpeningHours('2026-05-17', '14:00', HOURS_FULL_WEEK)).toEqual({ ok: true }); // Sun
  });
  it('OK inside dinner slot', () => {
    expect(checkOpeningHours('2026-05-12', '21:30', HOURS_FULL_WEEK)).toEqual({ ok: true }); // Tue
  });
  it('closed_day on Monday — includes nextOpen Tue', () => {
    const r = checkOpeningHours('2026-05-11', '20:00', HOURS_FULL_WEEK); // Mon
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('closed_day');
      expect(r.reason === 'closed_day' && r.nextOpen?.weekday).toBe('martes');
    }
  });
  it('outside_hours when time falls between shifts', () => {
    const r = checkOpeningHours('2026-05-14', '17:00', HOURS_FULL_WEEK); // Thu, between lunch close (16) and dinner open (20)
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'outside_hours') {
      expect(r.hoursToday).toContain('13:00-16:00');
      expect(r.hoursToday).toContain('20:00-23:30');
    }
  });
  it('lunch boundary inclusive: 16:00 is OK', () => {
    expect(checkOpeningHours('2026-05-17', '16:00', HOURS_FULL_WEEK).ok).toBe(true);
  });
});
