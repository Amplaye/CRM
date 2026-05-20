import { describe, it, expect } from 'vitest';
import { applyOfftopicGuard, getOfftopicReply } from './offtopic';
import { emptySession, type DialogSession } from '../types';

function sessionWith(overrides: Partial<DialogSession> = {}): DialogSession {
  return { ...emptySession(), ...overrides };
}

describe('FIX B32 — applyOfftopicGuard', () => {
  it('fires when intent is offtopic', () => {
    const out = applyOfftopicGuard(sessionWith({ intent: 'offtopic' }));
    expect(out.fired).toBe(true);
  });

  it.each(['book', 'modify', 'cancel', 'waitlist', 'info', null] as const)(
    'does NOT fire for intent=%s',
    (intent) => {
      const out = applyOfftopicGuard(sessionWith({ intent }));
      expect(out.fired).toBe(false);
    },
  );

  describe('reply in customer language', () => {
    it.each([
      ['es', 'Disculpa, aquí solo puedo ayudarte'],
      ['it', 'Scusa, qui posso aiutarti'],
      ['en', 'Sorry, here I can only help'],
      ['de', 'Entschuldigung, hier kann ich nur'],
    ] as const)('%s → %s', (lang, fragment) => {
      const out = applyOfftopicGuard(sessionWith({ intent: 'offtopic', lang }));
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.reply).toContain(fragment);
      }
    });
  });

  describe('session reset patch', () => {
    it('clears intent and lastInstructionTopic', () => {
      const out = applyOfftopicGuard(sessionWith({ intent: 'offtopic' }));
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.sessionResetPatch.intent).toBe(null);
        expect(out.sessionResetPatch.lastInstructionTopic).toBe(null);
      }
    });

    it('clears all booking fields', () => {
      const out = applyOfftopicGuard(sessionWith({ intent: 'offtopic' }));
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.sessionResetPatch.fields).toEqual({
          personas: null,
          fecha: null,
          hora: null,
          zona: null,
          nombre: null,
          notas: null,
          notas_asked: false,
          availability_checked: false,
        });
      }
    });

    it('clears lastModifyAttempt', () => {
      const out = applyOfftopicGuard(sessionWith({ intent: 'offtopic' }));
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.sessionResetPatch.lastModifyAttempt).toBe(null);
      }
    });
  });

  describe('language fallback', () => {
    it('falls back to es when lang is unknown / missing', () => {
      // Bypass type-checking the lang field to simulate runtime ambiguity
      const out = applyOfftopicGuard({ intent: 'offtopic', lang: 'fr' as unknown as 'es' });
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.reply).toContain('Disculpa');
      }
    });
  });

  describe('getOfftopicReply (standalone helper)', () => {
    it('returns the canned reply for each language', () => {
      expect(getOfftopicReply('es')).toContain('Disculpa');
      expect(getOfftopicReply('it')).toContain('Scusa');
      expect(getOfftopicReply('en')).toContain('Sorry');
      expect(getOfftopicReply('de')).toContain('Entschuldigung');
    });
  });
});
