import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { maybeSplitPdf } from './pdf-split';

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([300, 400]);
    p.drawText(`Pagina ${i + 1}`, { x: 40, y: 200 });
  }
  return await doc.save();
}

// Decode a chunk's base64 and count its pages to prove the split is real.
async function chunkPageCount(b64: string): Promise<number> {
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

describe('maybeSplitPdf', () => {
  it('does NOT chunk a small PDF (<= pages-per-chunk)', async () => {
    const pdf = await makePdf(3);
    const res = await maybeSplitPdf(pdf, 4);
    expect(res.chunked).toBe(false);
    if (!res.chunked) expect(res.pageCount).toBe(3);
  });

  it('chunks a large PDF into page-bounded sub-PDFs', async () => {
    const pdf = await makePdf(14);
    const res = await maybeSplitPdf(pdf, 4);
    expect(res.chunked).toBe(true);
    if (res.chunked) {
      expect(res.pageCount).toBe(14);
      expect(res.chunks.length).toBe(4); // 4+4+4+2
      const counts = await Promise.all(res.chunks.map(chunkPageCount));
      expect(counts).toEqual([4, 4, 4, 2]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(14);
    }
  });

  it('does not detach the caller buffer', async () => {
    const pdf = await makePdf(10);
    const len = pdf.length;
    await maybeSplitPdf(pdf, 4);
    expect(pdf.length).toBe(len); // still usable after the call
  });

  it('never throws on garbage input (returns not-chunked)', async () => {
    const res = await maybeSplitPdf(new Uint8Array([1, 2, 3, 4]), 4);
    expect(res.chunked).toBe(false);
  });
});
