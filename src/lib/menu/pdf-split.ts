// Split a large image-only PDF into smaller page-chunks so the vision worker
// can read a huge menu without (a) blowing past its ~140s OpenAI timeout or
// (b) overflowing gpt-4o's 16k output-token cap mid-JSON.
//
// Why split into sub-PDFs instead of rasterizing to images: pdf.js needs a
// native canvas to rasterize (not available free on Vercel/Deno), whereas
// pdf-lib (pure JS, no native deps) can copy page ranges into new small PDFs
// that PRESERVE the page images. OpenAI vision reads every page of each chunk.
// Verified: copyPages deep-copies image XObjects, so a 14-page image PDF splits
// into 4-page image PDFs with the pictures intact.
//
// Only image-only PDFs reach here — text PDFs already take the cheap text path
// upstream. A small PDF (<= PAGES_PER_CHUNK pages) is left alone (no chunks).

import { PDFDocument } from 'pdf-lib';
import { PAGES_PER_CHUNK } from './limits';

export type PdfSplit =
  | { chunked: false; pageCount: number }
  | { chunked: true; pageCount: number; chunks: string[] };

/**
 * Inspect a PDF and, if it has more than `pagesPerChunk` pages, split it into
 * base64-encoded page-chunks. Returns { chunked:false } when the PDF is small
 * enough to read in one vision call (the caller then uses the whole file as
 * before) or when anything goes wrong (never throws — falls back to whole-file).
 *
 * Takes a COPY of the bytes for pdf-lib so it can't neuter the caller's buffer
 * (same footgun as pdf.js — see pdf-text.ts).
 */
export async function maybeSplitPdf(
  bytes: Uint8Array,
  pagesPerChunk: number = PAGES_PER_CHUNK
): Promise<PdfSplit> {
  try {
    const src = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
    const pageCount = src.getPageCount();
    if (pageCount <= pagesPerChunk) {
      return { chunked: false, pageCount };
    }

    const chunks: string[] = [];
    for (let start = 0; start < pageCount; start += pagesPerChunk) {
      const end = Math.min(start + pagesPerChunk, pageCount);
      const out = await PDFDocument.create();
      const indices = Array.from({ length: end - start }, (_, k) => start + k);
      const copied = await out.copyPages(src, indices);
      copied.forEach((p) => out.addPage(p));
      const chunkBytes = await out.save();
      chunks.push(Buffer.from(chunkBytes).toString('base64'));
    }
    // Defensive: if for some reason we produced 0 or 1 chunk, treat as not
    // chunked so the caller uses the whole file.
    if (chunks.length <= 1) return { chunked: false, pageCount };
    return { chunked: true, pageCount, chunks };
  } catch {
    return { chunked: false, pageCount: 0 };
  }
}
