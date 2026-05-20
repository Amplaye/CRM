import { describe, it, expect } from 'vitest';
import { detectLang, applyStickyLang } from './sticky-lang';

describe('detectLang — strong markers', () => {
  it.each([
    ['hola, quiero reservar para 4', 'es'],
    ['gracias por la información', 'es'],
    ['¿cuándo abrís hoy?', 'es'],
    ['mañana noche para cena', 'es'],
  ])('ES: "%s" → es', (msg) => {
    const out = detectLang(msg);
    expect(out.lang).toBe('es');
    expect(out.strong).toBe(true);
  });

  it.each([
    ['ciao, vorrei prenotare un tavolo per 4 persone', 'it'],
    ['grazie mille per la prenotazione', 'it'],
    ['perché non riesco a modificare?', 'it'],
    ['domani sera per due persone', 'it'],
  ])('IT: "%s" → it', (msg) => {
    const out = detectLang(msg);
    expect(out.lang).toBe('it');
    expect(out.strong).toBe(true);
  });

  it.each([
    ['hi, can I book a table for tomorrow', 'en'],
    ['thanks for the reservation', 'en'],
    ['good evening, do you have availability', 'en'],
    ['I want to modify my booking', 'en'],
  ])('EN: "%s" → en', (msg) => {
    const out = detectLang(msg);
    expect(out.lang).toBe('en');
    expect(out.strong).toBe(true);
  });

  it.each([
    ['hallo, ich möchte einen Tisch reservieren', 'de'],
    ['guten Tag, für vier Personen bitte', 'de'],
    ['ich hätte gern eine Reservierung', 'de'],
    ['für 4 Personen drinnen', 'de'],
  ])('DE: "%s" → de', (msg) => {
    const out = detectLang(msg);
    expect(out.lang).toBe('de');
    expect(out.strong).toBe(true);
  });

  it('reports strongCount = distinct markers', () => {
    const out = detectLang('hola gracias por la reserva');
    expect(out.lang).toBe('es');
    expect(out.strongCount).toBeGreaterThanOrEqual(2);
  });

  it('"mañana mañana" counts as 1 distinct marker', () => {
    const out = detectLang('mañana mañana mañana');
    expect(out.lang).toBe('es');
    expect(out.strongCount).toBe(1);
  });
});

describe('detectLang — weak fallback', () => {
  it('needs ≥2 weak hits — single weak hit → null', () => {
    const out = detectLang('por favor');
    expect(out.lang).toBe(null);
  });

  it('2 weak ES phrases → es weak detection', () => {
    const out = detectLang('por favor las personas');
    expect(['es']).toContain(out.lang);
  });
});

describe('detectLang — edge cases', () => {
  it('empty → null', () => {
    expect(detectLang('').lang).toBe(null);
    expect(detectLang(null).lang).toBe(null);
    expect(detectLang(undefined).lang).toBe(null);
  });

  it('single accented char in a name → does NOT count as strong', () => {
    const out = detectLang('Núñez');
    expect(out.strong).toBe(false);
    expect(out.lang).toBe(null);
  });

  it('emoji-only / gibberish → null', () => {
    expect(detectLang('🤔🤔🤔').lang).toBe(null);
    expect(detectLang('asdfasdf').lang).toBe(null);
  });
});

describe('applyStickyLang — adoption (no previous)', () => {
  it('adopts detected language when previousLang is null', () => {
    const r = applyStickyLang(null, 'ciao, vorrei prenotare');
    expect(r.lang).toBe('it');
    expect(r.flipped).toBe(true);
  });

  it('returns null when no previousLang and no detection', () => {
    const r = applyStickyLang(null, 'Núñez');
    expect(r.lang).toBe(null);
    expect(r.flipped).toBe(false);
  });
});

describe('applyStickyLang — sticky behavior', () => {
  it('keeps previous lang when current message has no detection', () => {
    const r = applyStickyLang('it', 'ok');
    expect(r.lang).toBe('it');
    expect(r.flipped).toBe(false);
  });

  it('keeps previous lang when borrowed single foreign word', () => {
    // "gracias" alone is 1 strong ES marker → not enough to flip from IT.
    const r = applyStickyLang('it', 'gracias');
    expect(r.lang).toBe('it');
    expect(r.flipped).toBe(false);
  });

  it('keeps previous lang when foreign name with accents only', () => {
    // Argentinian customer named Núñez writing in Italian flow.
    const r = applyStickyLang('it', 'Núñez');
    expect(r.lang).toBe('it');
    expect(r.flipped).toBe(false);
  });

  it('flips when ≥2 distinct strong markers of new language', () => {
    const r = applyStickyLang('it', 'hola gracias por la reserva');
    expect(r.lang).toBe('es');
    expect(r.flipped).toBe(true);
  });

  it('keeps lang with same lang + 1 strong marker (no flip needed)', () => {
    const r = applyStickyLang('es', 'mañana');
    expect(r.lang).toBe('es');
    expect(r.flipped).toBe(false);
  });

  it('keeps lang even if detection has same language with stronger signal', () => {
    const r = applyStickyLang('es', 'hola gracias reserva mañana');
    expect(r.lang).toBe('es');
    expect(r.flipped).toBe(false);
  });
});
