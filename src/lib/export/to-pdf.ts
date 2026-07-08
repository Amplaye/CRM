// Branded PDF report builder shared by the report pages (P&L, Analytics).
// pdf-lib is low-level: this keeps to a clean header + simple tables, no charts.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { CsvCell } from "./to-csv";

// Brand palette (cream / bronze — see settings pages).
const BRONZE = rgb(196 / 255, 149 / 255, 106 / 255);
const CREAM = rgb(252 / 255, 246 / 255, 237 / 255);
const INK = rgb(0.1, 0.09, 0.08);
const MUTED = rgb(0.42, 0.38, 0.34);

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const ROW_H = 18;

export interface PdfReportSection {
  /** Optional section heading. */
  title?: string;
  /** Column headers; also fixes the column count. */
  columns: string[];
  rows: CsvCell[][];
}

export interface PdfReportOptions {
  /** Report title, e.g. "Conto economico". */
  title: string;
  /** Period / context line under the title. */
  subtitle?: string;
  /** Restaurant name shown in the header band. */
  business?: string;
  sections: PdfReportSection[];
  /** Footer note, e.g. generation date. Page numbers are added automatically. */
  footer?: string;
}

// Standard fonts are WinAnsi-only: map common typography, drop the rest.
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿");
function sanitize(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WINANSI_EXTRA.has(ch)) {
      out += ch;
    } else if (ch === "→") out += "->";
    else out += "?";
  }
  return out;
}

function cellText(cell: CsvCell): string {
  if (cell == null) return "—";
  return sanitize(String(cell));
}

/** Truncate `text` so it fits `maxWidth` at `size`, appending an ellipsis. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

/** Build a branded tabular PDF report. Returns the raw PDF bytes. */
export async function buildReportPdf(opts: PdfReportOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = A4;
  const usable = W - MARGIN * 2;

  let page!: PDFPage;
  let y = 0;

  const addPage = () => {
    page = doc.addPage(A4);
    y = H - MARGIN;
  };

  const ensureRoom = (needed: number) => {
    if (y - needed < MARGIN + 30) addPage();
  };

  addPage();

  // ── Header band ──
  page.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: CREAM });
  page.drawRectangle({ x: 0, y: H - 112, width: W, height: 2, color: BRONZE });
  if (opts.business) {
    page.drawText(sanitize(opts.business), { x: MARGIN, y: H - 44, size: 11, font: bold, color: BRONZE });
  }
  page.drawText(sanitize(opts.title), { x: MARGIN, y: H - 68, size: 20, font: bold, color: INK });
  if (opts.subtitle) {
    page.drawText(sanitize(opts.subtitle), { x: MARGIN, y: H - 88, size: 10, font: regular, color: MUTED });
  }
  y = H - 112 - 28;

  // ── Sections ──
  for (const section of opts.sections) {
    const cols = Math.max(1, section.columns.length);
    // First column gets more room (labels), the rest split evenly.
    const firstW = cols > 1 ? usable * 0.4 : usable;
    const otherW = cols > 1 ? (usable - firstW) / (cols - 1) : 0;
    const colX = (i: number) => MARGIN + (i === 0 ? 0 : firstW + otherW * (i - 1));
    const colW = (i: number) => (i === 0 ? firstW : otherW) - 8;

    if (section.title) {
      ensureRoom(ROW_H * 3);
      page.drawText(sanitize(section.title), { x: MARGIN, y, size: 12, font: bold, color: BRONZE });
      y -= ROW_H;
    }

    const drawHeaderRow = () => {
      section.columns.forEach((c, i) => {
        page.drawText(fit(sanitize(c), bold, 8.5, colW(i)), {
          x: colX(i),
          y: y - 11,
          size: 8.5,
          font: bold,
          color: MUTED,
        });
      });
      page.drawRectangle({ x: MARGIN, y: y - ROW_H + 2, width: usable, height: 1, color: BRONZE });
      y -= ROW_H;
    };

    ensureRoom(ROW_H * 2);
    drawHeaderRow();

    section.rows.forEach((row, rIdx) => {
      if (y - ROW_H < MARGIN + 30) {
        addPage();
        drawHeaderRow();
      }
      if (rIdx % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - ROW_H + 4, width: usable, height: ROW_H - 2, color: CREAM });
      }
      row.slice(0, cols).forEach((cell, i) => {
        page.drawText(fit(cellText(cell), i === 0 ? bold : regular, 9.5, colW(i)), {
          x: colX(i),
          y: y - 10,
          size: 9.5,
          font: i === 0 ? bold : regular,
          color: INK,
        });
      });
      y -= ROW_H;
    });

    y -= ROW_H; // gap between sections
  }

  // ── Footer on every page ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawRectangle({ x: MARGIN, y: MARGIN - 14, width: usable, height: 0.8, color: BRONZE });
    if (opts.footer) {
      p.drawText(sanitize(opts.footer), { x: MARGIN, y: MARGIN - 28, size: 8, font: regular, color: MUTED });
    }
    const label = `${i + 1} / ${pages.length}`;
    p.drawText(label, {
      x: W - MARGIN - regular.widthOfTextAtSize(label, 8),
      y: MARGIN - 28,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return doc.save();
}

/** Trigger a browser download of PDF bytes. */
export function downloadPdf(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
