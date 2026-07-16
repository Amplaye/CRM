// Shared CSV export for the report pages (P&L, Analytics).
// Pure builder (testable) + tiny browser download helper.

export type CsvCell = string | number | null | undefined;

/** Escape one cell: quote when it contains the separator, quotes or newlines. */
function escapeCell(cell: CsvCell, separator: string): string {
  if (cell == null) return "";
  const s = String(cell);
  if (s.includes(separator) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Rows → CSV text. `;` separator by default (Excel-friendly in EU locales). */
export function toCsv(rows: CsvCell[][], separator = ";"): string {
  return rows.map((row) => row.map((c) => escapeCell(c, separator)).join(separator)).join("\r\n");
}

/** Trigger a browser download of the rows as a .csv file (UTF-8 BOM for Excel). */
export function downloadCsv(filename: string, rows: CsvCell[][], separator = ";"): void {
  const blob = new Blob(["﻿" + toCsv(rows, separator)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
