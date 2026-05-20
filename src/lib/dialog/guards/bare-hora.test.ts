import { describe, it, expect } from 'vitest';
import { extractBareNumber, applyBareHoraGuard } from './bare-hora';
import type { ParserOutput } from '../types';

const baseExtract: ParserOutput = {
  intent: null,
  personas: null,
  delta_personas: null,
  fecha: null,
  hora: null,
  zona: null,
  nombre: null,
  notas: null,
  confirmacion: null,
};

describe('extractBareNumber', () => {
  describe('digit-only', () => {
    it.each([
      ['1', 1],
      ['9', 9],
      ['13', 13],
      ['20', 20],
      ['25', 25],
      ['30', 30],
    ])('"%s" → %d', (msg, expected) => {
      expect(extractBareNumber(msg)).toBe(expected);
    });

    it.each([
      ['0', null],
      ['31', null],
      ['100', null],
    ])('"%s" → out of range', (msg, expected) => {
      expect(extractBareNumber(msg)).toBe(expected);
    });

    it('digit with punctuation around it', () => {
      expect(extractBareNumber('!4!')).toBe(4);
      expect(extractBareNumber('. 5 .')).toBe(5);
    });
  });

  describe('word numbers', () => {
    it.each([
      ['uno', 1], ['una', 1], ['dos', 2], ['cinco', 5], ['diez', 10],
      ['quince', 15], ['veinte', 20], ['dieciséis', 16], ['dieciseis', 16],
    ])('Spanish "%s" → %d', (msg, expected) => {
      expect(extractBareNumber(msg)).toBe(expected);
    });

    it.each([
      ['due', 2], ['cinque', 5], ['dieci', 10], ['venti', 20], ['quattordici', 14],
    ])('Italian "%s" → %d', (msg, expected) => {
      expect(extractBareNumber(msg)).toBe(expected);
    });

    it.each([
      ['one', 1], ['two', 2], ['ten', 10], ['twenty', 20], ['thirteen', 13],
    ])('English "%s" → %d', (msg, expected) => {
      expect(extractBareNumber(msg)).toBe(expected);
    });

    it('case-insensitive', () => {
      expect(extractBareNumber('TRES')).toBe(3);
      expect(extractBareNumber('Cinque')).toBe(5);
    });
  });

  describe('prefix stripping', () => {
    it.each([
      ['somos 4', 4],
      ['seremos 10', 10],
      ['siamo 6', 6],
      ['saremo 8', 8],
      ["we're 5", 5],
      ['we are 7', 7],
      ['para 3', 3],
      ['per 9', 9],
      ['somos diez', 10],
      ['siamo cinque', 5],
    ])('"%s" → %d', (msg, expected) => {
      expect(extractBareNumber(msg)).toBe(expected);
    });
  });

  describe('rejects non-bare', () => {
    it.each([
      'hola',
      'a las 9',
      '4 personas el sábado',
      '',
      '   ',
      'mi nombre es Juan',
    ])('"%s" → null', (msg) => {
      expect(extractBareNumber(msg)).toBe(null);
    });
  });
});

describe('FIX B38 / B38b — applyBareHoraGuard', () => {
  describe('topic = hora', () => {
    it('"9" → 21:00 (PM mapping)', () => {
      const out = applyBareHoraGuard({ ...baseExtract }, '9', 'hora');
      expect(out.fired).toBe(true);
      expect(out.result.hora).toBe('21:00');
    });

    it('"7" → 19:00 (PM mapping)', () => {
      expect(applyBareHoraGuard({ ...baseExtract }, '7', 'hora').result.hora).toBe('19:00');
    });

    it('"12" → 12:00 (noon, no +12)', () => {
      expect(applyBareHoraGuard({ ...baseExtract }, '12', 'hora').result.hora).toBe('12:00');
    });

    it('"13" → 13:00 (FIX B38 — accept bare 24h)', () => {
      expect(applyBareHoraGuard({ ...baseExtract }, '13', 'hora').result.hora).toBe('13:00');
    });

    it('"22" → 22:00 (FIX B38 — accept bare 24h)', () => {
      expect(applyBareHoraGuard({ ...baseExtract }, '22', 'hora').result.hora).toBe('22:00');
    });

    it('"23" → 23:00 (last valid)', () => {
      expect(applyBareHoraGuard({ ...baseExtract }, '23', 'hora').result.hora).toBe('23:00');
    });

    it('"24" → out of range, no fire', () => {
      const out = applyBareHoraGuard({ ...baseExtract }, '24', 'hora');
      expect(out.fired).toBe(false);
      expect(out.result.hora).toBe(null);
    });

    it('FIX B38b — clears wrongly-classified personas when matching bare', () => {
      const out = applyBareHoraGuard({ ...baseExtract, personas: 9 }, '9', 'hora');
      expect(out.fired).toBe(true);
      expect(out.result.personas).toBe(null);
      expect(out.result.hora).toBe('21:00');
    });

    it('FIX B38b — clears wrongly-classified fecha when day-of-month matches', () => {
      const out = applyBareHoraGuard(
        { ...baseExtract, fecha: '2026-05-09' },
        '9',
        'hora',
      );
      expect(out.fired).toBe(true);
      expect(out.result.fecha).toBe(null);
    });

    it('preserves other personas value when it differs from bare', () => {
      const out = applyBareHoraGuard({ ...baseExtract, personas: 4 }, '9', 'hora');
      expect(out.result.personas).toBe(4);
      expect(out.result.hora).toBe('21:00');
    });

    it('does not overwrite parser-supplied hora', () => {
      const out = applyBareHoraGuard(
        { ...baseExtract, hora: '20:30' },
        '9',
        'hora',
      );
      expect(out.fired).toBe(false);
      expect(out.result.hora).toBe('20:30');
    });
  });

  describe('topic = personas', () => {
    it('"6" → personas=6', () => {
      const out = applyBareHoraGuard({ ...baseExtract }, '6', 'personas');
      expect(out.fired).toBe(true);
      expect(out.result.personas).toBe(6);
    });

    it('word number "diez" → personas=10', () => {
      const out = applyBareHoraGuard({ ...baseExtract }, 'diez', 'personas');
      expect(out.fired).toBe(true);
      expect(out.result.personas).toBe(10);
    });

    it('does not overwrite parser-supplied personas', () => {
      const out = applyBareHoraGuard(
        { ...baseExtract, personas: 5 },
        '6',
        'personas',
      );
      expect(out.fired).toBe(false);
      expect(out.result.personas).toBe(5);
    });
  });

  describe('topic = null', () => {
    it('does not fire even with bare number', () => {
      const out = applyBareHoraGuard({ ...baseExtract }, '9', null);
      expect(out.fired).toBe(false);
      expect(out.result.hora).toBe(null);
      expect(out.result.personas).toBe(null);
    });
  });

  describe('non-bare messages', () => {
    it('"hola" → no fire', () => {
      expect(applyBareHoraGuard({ ...baseExtract }, 'hola', 'hora').fired).toBe(false);
    });

    it('"a las 9" → no fire (not bare)', () => {
      expect(applyBareHoraGuard({ ...baseExtract }, 'a las 9', 'hora').fired).toBe(false);
    });
  });
});
