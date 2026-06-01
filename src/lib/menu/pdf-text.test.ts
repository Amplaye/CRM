import { describe, it, expect } from 'vitest';
import { tidyPdfText } from './pdf-text';

describe('tidyPdfText', () => {
  it('collapses letter-spaced glyph runs back into words', () => {
    const input = 'R i s t o r a n t e d a l 1 9 9 1';
    const out = tidyPdfText(input);
    // Should no longer be mostly single-char tokens.
    expect(out).toContain('Ristorante');
  });

  it('leaves normal prose untouched', () => {
    const input = 'Spaghetti alla carbonara con guanciale e pecorino';
    expect(tidyPdfText(input)).toBe(input);
  });

  it('collapses runs of extra spaces', () => {
    expect(tidyPdfText('Pizza      Margherita')).toBe('Pizza Margherita');
  });

  it('collapses 3+ blank lines to a double newline', () => {
    expect(tidyPdfText('Antipasti\n\n\n\nPrimi')).toBe('Antipasti\n\nPrimi');
  });

  it('strips carriage returns and trims', () => {
    expect(tidyPdfText('  \r\nDolci\r\n  ')).toBe('Dolci');
  });

  it('does not mangle a real short line of multi-char words', () => {
    const input = 'Vino rosso della casa';
    expect(tidyPdfText(input)).toBe(input);
  });
});
