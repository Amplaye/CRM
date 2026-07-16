import { describe, it, expect } from 'vitest';
import { tidyPdfText, tryExtractPdfText } from './pdf-text';

// Minimal valid 1-page PDF with no text layer — stands in for a design-exported
// / scanned menu (e.g. the Fuji carta, whose dishes are vector outlines).
const TEXTLESS_PDF = new TextEncoder().encode(
  `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
164
%%EOF`
);

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

describe('tryExtractPdfText', () => {
  // Regression for "Job has no file_base64/source_text to extract": pdf.js (via
  // unpdf) transfers/neuters the ArrayBuffer it's handed. tryExtractPdfText must
  // copy its input, or the caller's buffer ends up detached (length 0) — which
  // made image-only PDFs get stored with an EMPTY file_base64 and the worker
  // had nothing to extract.
  it('does NOT detach the caller buffer (image-only PDF → vision fallback still has bytes)', async () => {
    const bytes = TEXTLESS_PDF.slice();
    const before = bytes.length;

    const result = await tryExtractPdfText(bytes);

    // No usable text layer → caller falls back to sending the file to vision.
    expect(result).toBeNull();
    // The original buffer MUST survive so the base64 fallback isn't empty.
    expect(bytes.length).toBe(before);
    expect(Buffer.from(bytes).toString('base64').length).toBeGreaterThan(0);
  });
});
