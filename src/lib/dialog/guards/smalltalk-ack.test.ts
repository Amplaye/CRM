import { describe, it, expect } from 'vitest';
import {
  applySmalltalkAck,
  type SmalltalkAckInput,
  type SmalltalkAckContext,
} from './smalltalk-ack';
import type { ParserOutput } from '../types';

const baseParsed: ParserOutput = {
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

const safeCtx: SmalltalkAckContext = {
  proposedZone: null,
  proposedDate: null,
  proposedHora: null,
  awaitingDisambig: false,
  editingPending: false,
  pending: null,
  hasPendingBooking: false,
  hasPendingWaitlist: false,
};

function inp(overrides: Partial<SmalltalkAckInput> = {}): SmalltalkAckInput {
  return {
    message: '',
    lang: 'es',
    parsed: baseParsed,
    context: safeCtx,
    ...overrides,
  };
}

describe('FIX B31 — applySmalltalkAck', () => {
  describe('detection — fires on pure ack', () => {
    it('single-token "ok"', () => {
      const out = applySmalltalkAck(inp({ message: 'ok' }));
      expect(out.fired).toBe(true);
    });

    it('single-token "gracias"', () => {
      const out = applySmalltalkAck(inp({ message: 'gracias' }));
      expect(out.fired).toBe(true);
    });

    it('two-token "vale gracias"', () => {
      const out = applySmalltalkAck(inp({ message: 'vale gracias' }));
      expect(out.fired).toBe(true);
    });

    it('"muchas gracias"', () => {
      const out = applySmalltalkAck(inp({ message: 'muchas gracias' }));
      expect(out.fired).toBe(true);
    });

    it('uppercase normalized: "VALE GRACIAS"', () => {
      const out = applySmalltalkAck(inp({ message: 'VALE GRACIAS' }));
      expect(out.fired).toBe(true);
    });

    it('strips punctuation: "vale!!! gracias??"', () => {
      const out = applySmalltalkAck(inp({ message: 'vale!!! gracias??' }));
      expect(out.fired).toBe(true);
    });

    it('allows filler tokens "y" between acks', () => {
      const out = applySmalltalkAck(inp({ message: 'vale y gracias' }));
      expect(out.fired).toBe(true);
    });

    it('IT — "grazie mille"', () => {
      const out = applySmalltalkAck(inp({ message: 'grazie mille', lang: 'it' }));
      expect(out.fired).toBe(true);
    });

    it('IT — "perfetto grazie"', () => {
      const out = applySmalltalkAck(inp({ message: 'perfetto grazie', lang: 'it' }));
      expect(out.fired).toBe(true);
    });

    it('EN — "thanks"', () => {
      const out = applySmalltalkAck(inp({ message: 'thanks', lang: 'en' }));
      expect(out.fired).toBe(true);
    });

    it('EN — "thank you"', () => {
      const out = applySmalltalkAck(inp({ message: 'thank you', lang: 'en' }));
      expect(out.fired).toBe(true);
    });

    it('EN — "sounds good"', () => {
      const out = applySmalltalkAck(inp({ message: 'sounds good', lang: 'en' }));
      expect(out.fired).toBe(true);
    });

    it('DE — "danke"', () => {
      const out = applySmalltalkAck(inp({ message: 'danke', lang: 'de' }));
      expect(out.fired).toBe(true);
    });

    it('DE — "vielen dank"', () => {
      const out = applySmalltalkAck(inp({ message: 'vielen dank', lang: 'de' }));
      expect(out.fired).toBe(true);
    });

    it('DE — "alles klar"', () => {
      const out = applySmalltalkAck(inp({ message: 'alles klar', lang: 'de' }));
      expect(out.fired).toBe(true);
    });

    it('repeated same token still fires (set size = 1)', () => {
      const out = applySmalltalkAck(inp({ message: 'ok ok ok ok ok ok' }));
      expect(out.fired).toBe(true);
    });
  });

  describe('detection — does NOT fire', () => {
    it('empty message', () => {
      const out = applySmalltalkAck(inp({ message: '' }));
      expect(out.fired).toBe(false);
    });

    it('whitespace-only message', () => {
      const out = applySmalltalkAck(inp({ message: '   ' }));
      expect(out.fired).toBe(false);
    });

    it('mixed token (one non-ack word)', () => {
      const out = applySmalltalkAck(inp({ message: 'vale comer' }));
      expect(out.fired).toBe(false);
    });

    it('too many unique tokens (>5)', () => {
      // 6 distinct ack tokens
      const out = applySmalltalkAck(inp({ message: 'ok vale gracias perfecto genial dale' }));
      expect(out.fired).toBe(false);
    });

    it('plain greeting "hola" (not an ack)', () => {
      const out = applySmalltalkAck(inp({ message: 'hola' }));
      expect(out.fired).toBe(false);
    });

    it('plain "ciao" (not an ack)', () => {
      const out = applySmalltalkAck(inp({ message: 'ciao' }));
      expect(out.fired).toBe(false);
    });

    it('booking request', () => {
      const out = applySmalltalkAck(inp({ message: 'quiero reservar' }));
      expect(out.fired).toBe(false);
    });
  });

  describe('parser-extracted fields block firing', () => {
    it('personas extracted → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'gracias',
        parsed: { ...baseParsed, personas: 4 },
      }));
      expect(out.fired).toBe(false);
    });

    it('delta_personas extracted → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'gracias',
        parsed: { ...baseParsed, delta_personas: -1 },
      }));
      expect(out.fired).toBe(false);
    });

    it('fecha extracted → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'gracias',
        parsed: { ...baseParsed, fecha: '2026-06-01' },
      }));
      expect(out.fired).toBe(false);
    });

    it('hora extracted → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'gracias',
        parsed: { ...baseParsed, hora: '20:00' },
      }));
      expect(out.fired).toBe(false);
    });

    it('zona extracted → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'gracias',
        parsed: { ...baseParsed, zona: 'interior' },
      }));
      expect(out.fired).toBe(false);
    });

    it('nombre extracted → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'gracias',
        parsed: { ...baseParsed, nombre: 'Carlos' },
      }));
      expect(out.fired).toBe(false);
    });

    it('notas extracted → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'gracias',
        parsed: { ...baseParsed, notas: 'allergia ai latticini' },
      }));
      expect(out.fired).toBe(false);
    });
  });

  describe('unsafe-context blockers', () => {
    it('proposedZone set → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'vale',
        context: { ...safeCtx, proposedZone: 'interior' },
      }));
      expect(out.fired).toBe(false);
    });

    it('proposedDate set → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'vale',
        context: { ...safeCtx, proposedDate: '2026-06-01' },
      }));
      expect(out.fired).toBe(false);
    });

    it('proposedHora set → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'vale',
        context: { ...safeCtx, proposedHora: '20:00' },
      }));
      expect(out.fired).toBe(false);
    });

    it('awaitingDisambig → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'vale',
        context: { ...safeCtx, awaitingDisambig: true },
      }));
      expect(out.fired).toBe(false);
    });

    it('editingPending → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'vale',
        context: { ...safeCtx, editingPending: true },
      }));
      expect(out.fired).toBe(false);
    });

    it('pending=notas_ask → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'vale',
        context: { ...safeCtx, pending: 'notas_ask' },
      }));
      expect(out.fired).toBe(false);
    });

    it('hasPendingBooking → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'vale',
        context: { ...safeCtx, hasPendingBooking: true },
      }));
      expect(out.fired).toBe(false);
    });

    it('hasPendingWaitlist → does not fire', () => {
      const out = applySmalltalkAck(inp({
        message: 'vale',
        context: { ...safeCtx, hasPendingWaitlist: true },
      }));
      expect(out.fired).toBe(false);
    });
  });

  describe('reply pool & language', () => {
    it.each([
      ['es', '¡De nada!'],
      ['it', 'Di niente!'],
      ['en', 'You’re welcome!'],
      ['de', 'Gern geschehen!'],
    ] as const)('rng=0 picks first reply for %s', (lang, fragment) => {
      const out = applySmalltalkAck({
        ...inp({ message: 'gracias', lang }),
        rng: () => 0,
      });
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.reply).toContain(fragment);
      }
    });

    it('rng=0.999 picks last reply (es)', () => {
      const out = applySmalltalkAck({
        ...inp({ message: 'gracias' }),
        rng: () => 0.999,
      });
      expect(out.fired).toBe(true);
      if (out.fired) {
        // 4 replies in es pool → last is "¡Encantado de ayudarte!"
        expect(out.reply).toContain('Encantado de ayudarte');
      }
    });

    it('falls back to es pool for unknown lang', () => {
      const out = applySmalltalkAck({
        ...inp({ message: 'gracias', lang: 'fr' as unknown as 'es' }),
        rng: () => 0,
      });
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.reply).toContain('¡De nada!');
      }
    });
  });

  describe('session reset patch', () => {
    it('resets fields, sets intent=info, clears lastInstructionTopic', () => {
      const out = applySmalltalkAck(inp({ message: 'gracias' }));
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.sessionPatch.intent).toBe('info');
        expect(out.sessionPatch.lastInstructionTopic).toBe(null);
        expect(out.sessionPatch.fields).toEqual({
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

    it('does NOT include lastModifyTarget (preserved by caller)', () => {
      const out = applySmalltalkAck(inp({ message: 'gracias' }));
      expect(out.fired).toBe(true);
      if (out.fired) {
        expect(out.sessionPatch).not.toHaveProperty('lastModifyTarget');
      }
    });
  });

  describe('immutability', () => {
    it('does not mutate the parser output', () => {
      const parsed: ParserOutput = { ...baseParsed, intent: 'modify' };
      const before = JSON.stringify(parsed);
      applySmalltalkAck(inp({ message: 'gracias', parsed }));
      expect(JSON.stringify(parsed)).toBe(before);
    });
  });
});
