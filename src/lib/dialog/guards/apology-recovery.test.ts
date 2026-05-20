import { describe, it, expect } from 'vitest';
import { applyApologyRecovery, type ApologyRecoveryInput } from './apology-recovery';

const RP = '+34 828 712 623';

function baseInput(overrides: Partial<ApologyRecoveryInput> = {}): ApologyRecoveryInput {
  return {
    aiText: null,
    hasBookingData: false,
    hasModifyData: false,
    hasWaitlistData: false,
    lang: 'es',
    restaurantPhoneDisplay: RP,
    hadPreviousFailure: false,
    ...overrides,
  };
}

describe('FIX B7 — applyApologyRecovery', () => {
  describe('(a) silent-stuck branch', () => {
    it('fires when there is no aiText AND no booking/modify/waitlist data', () => {
      const out = applyApologyRecovery(baseInput());
      expect(out.kind).toBe('silent_stuck');
      if (out.kind === 'silent_stuck') {
        expect(out.setFailure).toBe(true);
        expect(out.aiText).toContain('Perdona');
        expect(out.aiText).toContain(RP);
      }
    });

    it('fires even when a prior failure was already flagged (re-flags)', () => {
      const out = applyApologyRecovery(baseInput({ hadPreviousFailure: true }));
      expect(out.kind).toBe('silent_stuck');
    });

    it.each([
      ['es', 'Perdona, en este momento'],
      ['it', 'Scusa, in questo momento'],
      ['en', "Sorry, I can't process your message"],
      ['de', 'Entschuldige, im Moment'],
    ] as const)('produces fallback in %s', (lang, fragment) => {
      const out = applyApologyRecovery(baseInput({ lang }));
      expect(out.kind).toBe('silent_stuck');
      if (out.kind === 'silent_stuck') {
        expect(out.aiText).toContain(fragment);
        expect(out.aiText).toContain(RP);
      }
    });

    it('falls back to es for unknown lang', () => {
      const out = applyApologyRecovery(baseInput({ lang: 'fr' as unknown as 'es' }));
      expect(out.kind).toBe('silent_stuck');
      if (out.kind === 'silent_stuck') {
        expect(out.aiText).toContain('Perdona');
      }
    });

    it('interpolates restaurant phone into the fallback', () => {
      const out = applyApologyRecovery(baseInput({ restaurantPhoneDisplay: '+39 02 1234567' }));
      expect(out.kind).toBe('silent_stuck');
      if (out.kind === 'silent_stuck') {
        expect(out.aiText).toContain('+39 02 1234567');
      }
    });
  });

  describe('(b) recovery branch', () => {
    it('prepends apology when prior failure + aiText present', () => {
      const out = applyApologyRecovery(baseInput({
        hadPreviousFailure: true,
        aiText: '¿Para cuántas personas?',
      }));
      expect(out.kind).toBe('recover');
      if (out.kind === 'recover') {
        expect(out.clearFailure).toBe(true);
        expect(out.aiText.startsWith('Perdona el silencio de antes')).toBe(true);
        expect(out.aiText).toContain('¿Para cuántas personas?');
      }
    });

    it('sends standalone apology (trailing whitespace stripped) when no aiText but bookingData', () => {
      const out = applyApologyRecovery(baseInput({
        hadPreviousFailure: true,
        hasBookingData: true,
      }));
      expect(out.kind).toBe('recover');
      if (out.kind === 'recover') {
        expect(out.aiText).toBe('Perdona el silencio de antes, ya está todo resuelto.');
        expect(out.aiText.endsWith('\n')).toBe(false);
      }
    });

    it('recovery fires for modifyData path', () => {
      const out = applyApologyRecovery(baseInput({
        hadPreviousFailure: true,
        hasModifyData: true,
      }));
      expect(out.kind).toBe('recover');
    });

    it('recovery fires for waitlistData path', () => {
      const out = applyApologyRecovery(baseInput({
        hadPreviousFailure: true,
        hasWaitlistData: true,
      }));
      expect(out.kind).toBe('recover');
    });

    it.each([
      ['es', 'Perdona el silencio'],
      ['it', 'Scusa il silenzio di prima'],
      ['en', "Sorry for the silence earlier"],
      ['de', 'Entschuldige die Stille zuvor'],
    ] as const)('localizes apology for %s', (lang, fragment) => {
      const out = applyApologyRecovery(baseInput({
        lang,
        hadPreviousFailure: true,
        aiText: 'X',
      }));
      expect(out.kind).toBe('recover');
      if (out.kind === 'recover') {
        expect(out.aiText).toContain(fragment);
      }
    });

    it('falls back to es apology for unknown lang', () => {
      const out = applyApologyRecovery(baseInput({
        lang: 'pt' as unknown as 'es',
        hadPreviousFailure: true,
        aiText: 'X',
      }));
      expect(out.kind).toBe('recover');
      if (out.kind === 'recover') {
        expect(out.aiText).toContain('Perdona el silencio');
      }
    });
  });

  describe('noop branch', () => {
    it('returns aiText unchanged when there was no prior failure and we have text', () => {
      const out = applyApologyRecovery(baseInput({ aiText: 'Hola' }));
      expect(out.kind).toBe('noop');
      if (out.kind === 'noop') {
        expect(out.aiText).toBe('Hola');
      }
    });

    it('returns null aiText unchanged when only data flows and no prior failure', () => {
      const out = applyApologyRecovery(baseInput({ hasBookingData: true }));
      expect(out.kind).toBe('noop');
      if (out.kind === 'noop') {
        expect(out.aiText).toBeNull();
      }
    });
  });
});
