import { describe, it, expect } from 'vitest';
import { applyEmptyModifyGuard } from './empty-modify';
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

const dummyReservation = {
  id: 'r1',
  fecha: '2026-05-22',
  hora: '21:00',
  personas: 4,
};

describe('FIX B34 — applyEmptyModifyGuard', () => {
  it('rewrites modify → book when no reservations exist', () => {
    const out = applyEmptyModifyGuard({ ...baseExtract, intent: 'modify' }, []);
    expect(out.fired).toBe(true);
    expect(out.result.intent).toBe('book');
  });

  it('rewrites cancel → book when no reservations exist', () => {
    const out = applyEmptyModifyGuard({ ...baseExtract, intent: 'cancel' }, []);
    expect(out.fired).toBe(true);
    expect(out.result.intent).toBe('book');
  });

  it('rewrites when existingReservations is null', () => {
    const out = applyEmptyModifyGuard({ ...baseExtract, intent: 'modify' }, null);
    expect(out.fired).toBe(true);
    expect(out.result.intent).toBe('book');
  });

  it('rewrites when existingReservations is undefined', () => {
    const out = applyEmptyModifyGuard({ ...baseExtract, intent: 'modify' }, undefined);
    expect(out.fired).toBe(true);
    expect(out.result.intent).toBe('book');
  });

  it('does NOT rewrite when reservations exist', () => {
    const out = applyEmptyModifyGuard({ ...baseExtract, intent: 'modify' }, [
      dummyReservation,
    ]);
    expect(out.fired).toBe(false);
    expect(out.result.intent).toBe('modify');
  });

  it('does NOT rewrite when intent is book', () => {
    const out = applyEmptyModifyGuard({ ...baseExtract, intent: 'book' }, []);
    expect(out.fired).toBe(false);
    expect(out.result.intent).toBe('book');
  });

  it('does NOT rewrite when intent is null', () => {
    const out = applyEmptyModifyGuard({ ...baseExtract, intent: null }, []);
    expect(out.fired).toBe(false);
    expect(out.result.intent).toBe(null);
  });

  it('does NOT rewrite when intent is info/offtopic/waitlist', () => {
    for (const intent of ['info', 'offtopic', 'waitlist'] as const) {
      const out = applyEmptyModifyGuard({ ...baseExtract, intent }, []);
      expect(out.fired).toBe(false);
      expect(out.result.intent).toBe(intent);
    }
  });

  it('preserves the rest of the parser output', () => {
    const input: ParserOutput = {
      ...baseExtract,
      intent: 'modify',
      personas: 4,
      fecha: '2026-05-22',
      nombre: 'Sofía',
    };
    const out = applyEmptyModifyGuard(input, []);
    expect(out.result).toEqual({ ...input, intent: 'book' });
  });

  it('does not mutate the input object', () => {
    const input: ParserOutput = { ...baseExtract, intent: 'modify' };
    applyEmptyModifyGuard(input, []);
    expect(input.intent).toBe('modify');
  });
});
