import { describe, it, expect } from 'vitest';
import { applyPostRecapGuard, getRecapHint } from './post-recap';
import { emptySession, type DialogSession } from '../types';

function sessionWith(overrides: Partial<DialogSession> = {}): DialogSession {
  return { ...emptySession(), ...overrides };
}

describe('FIX B41 — applyPostRecapGuard', () => {
  describe('intent = info', () => {
    it('with pending → reminder + info answer', () => {
      const out = applyPostRecapGuard({
        hasPending: true,
        session: sessionWith({ intent: 'info' }),
      });
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.nextInstruction).toContain('Responde brevemente');
        expect(out.nextInstruction).toContain('CONFIRMO');
        expect(out.lastInstructionTopic).toBe(null);
      }
    });

    it('without pending → answer + resume flow (no reminder)', () => {
      const out = applyPostRecapGuard({
        hasPending: false,
        session: sessionWith({ intent: 'info' }),
      });
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.nextInstruction).toContain('Responde brevemente');
        expect(out.nextInstruction).not.toContain('CONFIRMO');
        expect(out.nextInstruction).toContain('retoma el flujo');
      }
    });
  });

  describe('intent = book with pending and empty fields', () => {
    it('fires → reminder only', () => {
      const out = applyPostRecapGuard({
        hasPending: true,
        session: sessionWith({
          intent: 'book',
          fields: {
            personas: null, fecha: null, hora: null, zona: null,
            nombre: null, notas: null, notas_asked: false, availability_checked: false,
          },
        }),
      });
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.nextInstruction).toContain('CONFIRMO');
        expect(out.lastInstructionTopic).toBe('awaiting_confirmo');
      }
    });
  });

  describe('intent = book WITHOUT pending', () => {
    it('does NOT fire', () => {
      const out = applyPostRecapGuard({
        hasPending: false,
        session: sessionWith({ intent: 'book' }),
      });
      expect(out.fired).toBe(false);
    });
  });

  describe('intent = book with pending BUT fields are filled', () => {
    it('does NOT fire — normal book flow continues', () => {
      const out = applyPostRecapGuard({
        hasPending: true,
        session: sessionWith({
          intent: 'book',
          fields: {
            personas: 4, fecha: '2026-05-22', hora: '21:00', zona: 'exterior',
            nombre: 'Sofía', notas: null, notas_asked: true, availability_checked: true,
          },
        }),
      });
      expect(out.fired).toBe(false);
    });

    it('partial fields — does NOT fire (one populated)', () => {
      const out = applyPostRecapGuard({
        hasPending: true,
        session: sessionWith({
          intent: 'book',
          fields: {
            personas: 4, fecha: null, hora: null, zona: null,
            nombre: null, notas: null, notas_asked: false, availability_checked: false,
          },
        }),
      });
      expect(out.fired).toBe(false);
    });
  });

  describe('multilingual reminder', () => {
    it.each([
      ['es', 'CONFIRMO'],
      ['it', 'CONFERMO'],
      ['en', 'CONFIRM'],
      ['de', 'BESTÄTIGEN'],
    ] as const)('%s → contains %s', (lang, keyword) => {
      expect(getRecapHint(lang)).toContain(keyword);
    });

    it('renders post-recap text in session language', () => {
      const out = applyPostRecapGuard({
        hasPending: true,
        session: sessionWith({ intent: 'book', lang: 'it' }),
      });
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.nextInstruction).toContain('CONFERMO');
        expect(out.nextInstruction).not.toContain('CONFIRMO ');
      }
    });
  });

  describe('other intents', () => {
    it.each(['modify', 'cancel', 'waitlist', 'offtopic', null] as const)(
      'intent=%s → does NOT fire',
      (intent) => {
        const out = applyPostRecapGuard({
          hasPending: true,
          session: sessionWith({ intent }),
        });
        expect(out.fired).toBe(false);
      },
    );
  });
});
