// Extract plain text from office/data documents that aren't PDFs or images:
// Word (.docx) and CSV. Restaurant owners occasionally keep their menu in Word,
// or export it as CSV from a spreadsheet — both are trivially convertible to
// text and then go through the SAME text-extraction path as a PDF text layer
// (source='text' → OpenAI text call), which is fast and cheap.
//
// Deliberately NOT supported: legacy .doc, Apple Pages, ODT (no reliable
// pure-JS parser), and .xlsx — the only free xlsx parser (SheetJS on npm) has
// unpatched Prototype-Pollution + ReDoS advisories and the file is attacker-
// controlled (uploaded by a tenant). CSV needs no library at all, so it's safe.
//
// mammoth is pure JS (no native deps) and safe in Vercel serverless. Like
// pdf-text.ts, every function here NEVER throws — on any failure it returns
// null so the caller can surface a clean "unsupported / unreadable" error.

import mammoth from 'mammoth';

// Same minimums as pdf-text.ts: a document that yields almost nothing isn't a
// menu we can extract from, so we bail and let the caller report it.
const MIN_TEXT_CHARS = 50;

export type DocKind = 'docx' | 'csv';

// MIME types + extensions we accept. Some browsers send a blank or generic
// type for these, so callers should also check the filename extension.
export const DOC_MIME: Record<string, DocKind> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
  'application/csv': 'csv',
};

export function docKindFromName(name: string): DocKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.csv')) return 'csv';
  return null;
}

// Resolve a (mimeType, filename) pair to a DocKind, or null if it's not a doc
// we handle. The filename extension wins when the MIME type is missing/generic.
export function resolveDocKind(mimeType: string, fileName: string): DocKind | null {
  return DOC_MIME[mimeType.toLowerCase()] || docKindFromName(fileName);
}

/**
 * Turn a CSV buffer into readable text for the LLM. We don't parse it into a
 * grid — the menu-extraction model reads delimited text fine — we just decode
 * it and normalize line endings. Quoted fields with embedded commas are left
 * as-is (the model tolerates them; a full CSV parser would add a dependency for
 * no real gain here).
 */
function csvToText(bytes: Uint8Array): string {
  // Strip a UTF-8 BOM if present (Excel-exported CSVs often have one).
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }
  const text = new TextDecoder('utf-8').decode(bytes.subarray(start));
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract a usable text layer from a .docx or .csv buffer, or return null if
 * the kind is unsupported or there's too little text to be worth extracting.
 * Never throws.
 */
export async function tryExtractDocText(
  bytes: Uint8Array,
  kind: DocKind
): Promise<string | null> {
  try {
    let text: string;
    if (kind === 'csv') {
      text = csvToText(bytes);
    } else {
      // mammoth wants a Node Buffer; in serverless Node that's available.
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = (value || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    if (text.length < MIN_TEXT_CHARS) return null;
    // Cap at the same budget the worker uses for text (it slices to 100k too);
    // keeps a pathologically large CSV from ballooning the job row.
    return text.slice(0, 100_000);
  } catch {
    return null;
  }
}
