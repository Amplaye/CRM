import { describe, it, expect } from 'vitest';
import { isGreetingOnly } from './greeting-detection';

describe('FIX B27 — isGreetingOnly', () => {
  describe('matches Spanish greetings', () => {
    it.each([
      'hola',
      'Hola',
      'HOLA',
      'hola!',
      'hola.',
      'hola?',
      '¡hola!',
      'buenas',
      'buenas tardes',
      'buenas noches',
      'buenos días',
      'buenos dias',
      'saludos',
    ])('%s → true', (msg) => {
      expect(isGreetingOnly(msg)).toBe(true);
    });
  });

  describe('matches Italian greetings', () => {
    it.each(['ciao', 'salve', 'buongiorno', 'buon giorno', 'buonasera', 'buona sera'])(
      '%s → true',
      (msg) => {
        expect(isGreetingOnly(msg)).toBe(true);
      },
    );
  });

  describe('matches English greetings', () => {
    it.each(['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'])(
      '%s → true',
      (msg) => {
        expect(isGreetingOnly(msg)).toBe(true);
      },
    );
  });

  describe('rejects messages with content beyond the greeting', () => {
    it.each([
      'hola quiero reservar',
      'ciao vorrei prenotare per 4',
      'hi can I book',
      'hola, modifico la reserva',
      'buenas tardes, una pregunta',
    ])('%s → false', (msg) => {
      expect(isGreetingOnly(msg)).toBe(false);
    });
  });

  describe('handles edge cases', () => {
    it('empty string → false', () => {
      expect(isGreetingOnly('')).toBe(false);
    });

    it('whitespace only → false', () => {
      expect(isGreetingOnly('   ')).toBe(false);
    });

    it('null/undefined → false', () => {
      expect(isGreetingOnly(null)).toBe(false);
      expect(isGreetingOnly(undefined)).toBe(false);
    });

    it('greeting with surrounding spaces is trimmed', () => {
      expect(isGreetingOnly('  hola  ')).toBe(true);
    });

    it('non-greeting words → false', () => {
      expect(isGreetingOnly('quiero reservar')).toBe(false);
      expect(isGreetingOnly('a las 9')).toBe(false);
      expect(isGreetingOnly('4 personas')).toBe(false);
    });
  });
});
