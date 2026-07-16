import { describe, expect, it } from "vitest";
import { toCsv } from "./to-csv";
import { buildReportPdf } from "./to-pdf";

describe("toCsv", () => {
  it("joins rows with ; and CRLF", () => {
    expect(toCsv([["a", 1], ["b", 2.5]])).toBe("a;1\r\nb;2.5");
  });

  it("escapes separator, quotes and newlines", () => {
    expect(toCsv([["with;semi", 'say "hi"', "line\nbreak"]])).toBe('"with;semi";"say ""hi""";"line\nbreak"');
  });

  it("renders null/undefined as empty cells", () => {
    expect(toCsv([["a", null, undefined, 0]])).toBe("a;;;0");
  });

  it("supports a custom separator", () => {
    expect(toCsv([["a", "b"]], ",")).toBe("a,b");
  });
});

describe("buildReportPdf", () => {
  it("produces a non-empty PDF with header and rows", async () => {
    const bytes = await buildReportPdf({
      title: "Conto economico",
      subtitle: "Ultimi 30 giorni",
      business: "Trattoria Test",
      sections: [
        {
          title: "Riepilogo",
          columns: ["Voce", "Valore"],
          rows: [
            ["Ricavi", "€ 12.345"],
            ["Food cost", "€ 3.456"],
          ],
        },
      ],
      footer: "Generato il 2026-07-08 — TableFlow",
    });
    expect(bytes.length).toBeGreaterThan(1000);
    // %PDF magic header
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("paginates long tables without throwing", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`Riga ${i}`, i, i * 2]);
    const bytes = await buildReportPdf({
      title: "Report lungo",
      sections: [{ columns: ["Voce", "A", "B"], rows }],
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("sanitizes non-WinAnsi characters instead of throwing", async () => {
    const bytes = await buildReportPdf({
      title: "Emoji 😀 → test",
      sections: [{ columns: ["V"], rows: [["€ 10 — ok…"]] }],
    });
    expect(bytes.length).toBeGreaterThan(500);
  });
});
