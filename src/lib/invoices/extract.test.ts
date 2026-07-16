import { describe, it, expect } from "vitest";
import { parseInvoice, normalizeInvoice } from "@/lib/invoices/extract";

describe("parseInvoice", () => {
  it("strips markdown fences and leading prose", () => {
    const raw = "Here you go:\n```json\n{\"supplierName\":\"Metro\",\"lines\":[]}\n```";
    expect(parseInvoice(raw)).toMatchObject({ supplierName: "Metro" });
  });
});

describe("normalizeInvoice", () => {
  it("coerces numbers, converts dd/mm/yyyy, strips IT vat prefix", () => {
    const inv = normalizeInvoice({
      supplierName: "  Ortofrutta Rossi  ",
      supplierVat: "IT 01234567890",
      invoiceNumber: "2026/123",
      invoiceDate: "07/06/2026",
      currency: "eur",
      netTotal: "100,50",
      taxTotal: 10.05,
      grossTotal: "110,55",
      lines: [
        { description: "Pomodori", quantity: "5", unit: "kg", unitPrice: "2,00", lineTotal: "10,00", taxRate: 10 },
      ],
    });
    expect(inv.supplierName).toBe("Ortofrutta Rossi");
    expect(inv.supplierVat).toBe("01234567890");
    expect(inv.invoiceDate).toBe("2026-06-07");
    expect(inv.currency).toBe("EUR");
    expect(inv.netTotal).toBe(100.5);
    expect(inv.grossTotal).toBe(110.55);
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ description: "Pomodori", quantity: 5, unitPrice: 2, lineTotal: 10, taxRate: 10 });
  });

  it("returns nulls + empty lines for an unreadable doc", () => {
    const inv = normalizeInvoice({ rawNotes: "not an invoice", lines: [] });
    expect(inv.supplierName).toBeNull();
    expect(inv.lines).toEqual([]);
    expect(inv.currency).toBe("EUR");
  });

  it("rejects an invalid date (keeps null, never a bad value)", () => {
    expect(normalizeInvoice({ invoiceDate: "garbage" }).invoiceDate).toBeNull();
  });
});
