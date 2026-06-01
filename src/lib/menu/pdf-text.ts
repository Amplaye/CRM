// Try to pull a usable text layer out of a PDF. The win: a PDF that has real
// embedded text (the vast majority of modern restaurant menus, exported from
// Word/Canva/InDesign) can be sent to OpenAI as PLAIN TEXT instead of as an
// image for vision OCR. Text extraction is <2s and the OpenAI text call is far
// faster and cheaper than vision — which is what kept large PDFs under the 60s
// platform cap from finishing.
//
// Scanned/image-only PDFs have no text layer; for those this returns null and
// the caller falls back to sending the file to vision as before.
//
// Uses `unpdf` — a pure-JS pdf.js build with no native deps, safe in Vercel
// serverless (the project deliberately avoids pdfjs-dist + native canvas; see
// the note at src/lib/menu/extract.ts).

import { extractText, getDocumentProxy } from 'unpdf';

// Heuristics for "does this PDF have enough real text to skip vision?".
// A scanned menu typically yields ~0 chars; a real text menu yields hundreds+.
// We require a reasonable absolute amount AND a minimum of alphabetic content
// (so a PDF that only contains, say, page numbers doesn't get mis-classified).
const MIN_TEXT_CHARS = 200;
const MIN_ALPHA_CHARS = 120;

export type PdfTextResult = {
  text: string;
  totalPages: number;
};

/**
 * Some PDFs encode glyphs so pdf.js emits them letter-spaced
 * ("R i s t o r a n t e"). Collapse runs of single chars separated by single
 * spaces back into words, while leaving normal text untouched. This is a light
 * touch — OpenAI tolerates the raw form too, but cleaner input is cheaper and
 * slightly more reliable.
 */
export function tidyPdfText(raw: string): string {
  let s = raw.replace(/\r/g, '');
  // Collapse 3+ spaces to one, normalize tabs.
  s = s.replace(/\t/g, ' ');
  // Heuristic de-spacing: if a line is mostly "x y z" single-char tokens, join.
  s = s
    .split('\n')
    .map((line) => {
      const tokens = line.trim().split(/\s+/).filter(Boolean);
      if (tokens.length >= 6) {
        const singles = tokens.filter((t) => t.length === 1).length;
        if (singles / tokens.length > 0.6) {
          // Rebuild: join single chars into words, keep multi-char tokens as words.
          return line.replace(/(?<=\b\w) (?=\w\b)/g, '');
        }
      }
      return line;
    })
    .join('\n');
  // Collapse excessive blank lines / spaces.
  s = s.replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function countAlpha(s: string): number {
  const m = s.match(/[\p{L}]/gu);
  return m ? m.length : 0;
}

/**
 * Extract a usable text layer from a PDF buffer, or return null if the PDF is
 * image-only / has too little text to be worth sending as text.
 *
 * Never throws — on any failure (corrupt PDF, pdf.js error) it returns null so
 * the caller cleanly falls back to the vision path.
 */
export async function tryExtractPdfText(
  bytes: Uint8Array
): Promise<PdfTextResult | null> {
  try {
    // pdf.js (via unpdf) TRANSFERS/neuters the ArrayBuffer it's handed, leaving
    // the caller's `bytes` detached (length 0). Hand it a fresh copy so the
    // caller's buffer survives for any fallback path (e.g. re-encoding the
    // upload as base64 for the vision worker when there's no text layer).
    const copy = bytes.slice();
    const pdf = await getDocumentProxy(copy);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n') : text;
    const tidy = tidyPdfText(merged);
    if (tidy.length < MIN_TEXT_CHARS) return null;
    if (countAlpha(tidy) < MIN_ALPHA_CHARS) return null;
    return { text: tidy, totalPages };
  } catch {
    return null;
  }
}
