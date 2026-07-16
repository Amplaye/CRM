import { describe, it, expect } from 'vitest';
import { resolveDocKind, docKindFromName, tryExtractDocText } from './doc-text';

describe('resolveDocKind', () => {
  it('detects .docx by MIME', () => {
    expect(
      resolveDocKind(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'menu.docx'
      )
    ).toBe('docx');
  });
  it('detects csv by MIME', () => {
    expect(resolveDocKind('text/csv', 'x.csv')).toBe('csv');
    expect(resolveDocKind('application/csv', 'x.csv')).toBe('csv');
  });
  it('falls back to extension when MIME is blank/generic', () => {
    expect(resolveDocKind('', 'menu.docx')).toBe('docx');
    expect(resolveDocKind('application/octet-stream', 'list.csv')).toBe('csv');
  });
  it('returns null for PDF/images/unknown', () => {
    expect(resolveDocKind('application/pdf', 'menu.pdf')).toBeNull();
    expect(resolveDocKind('image/png', 'menu.png')).toBeNull();
    expect(resolveDocKind('', 'menu.pages')).toBeNull();
  });
});

describe('docKindFromName', () => {
  it('is case-insensitive on extension', () => {
    expect(docKindFromName('MENU.DOCX')).toBe('docx');
    expect(docKindFromName('Data.CSV')).toBe('csv');
  });
});

describe('tryExtractDocText (csv)', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('decodes CSV text and normalizes newlines', async () => {
    const csv =
      'Categoria,Piatto,Descrizione,Prezzo\r\n' +
      'Pizze,Margherita,Pomodoro e mozzarella,8\r\n' +
      'Pizze,Marinara,Pomodoro aglio origano,7\r\n' +
      'Primi,Carbonara,Uovo guanciale pecorino,12';
    const out = await tryExtractDocText(enc(csv), 'csv');
    expect(out).toContain('Margherita,Pomodoro e mozzarella,8');
    expect(out).not.toContain('\r');
  });

  it('strips a UTF-8 BOM', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = enc(
      'Categoria,Nome,Prezzo\nPizze,Diavola,9\nPizze,Quattro Formaggi,10\nDolci,Tiramisu,5'
    );
    const merged = new Uint8Array(bom.length + body.length);
    merged.set(bom);
    merged.set(body, bom.length);
    const out = await tryExtractDocText(merged, 'csv');
    expect(out?.startsWith('Categoria')).toBe(true);
  });

  it('returns null for near-empty content', async () => {
    expect(await tryExtractDocText(enc('a,b'), 'csv')).toBeNull();
  });
});
