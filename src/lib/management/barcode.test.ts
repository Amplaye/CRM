import { describe, it, expect } from "vitest";
import { isRetailBarcode } from "./barcode";

describe("isRetailBarcode", () => {
  it("accepts real EAN-13 codes off packaging", () => {
    expect(isRetailBarcode("8000500310427")).toBe(true); // Nutella 950g
    expect(isRetailBarcode("5449000000996")).toBe(true); // Coca-Cola 330ml
  });

  it("accepts EAN-8 and UPC-A", () => {
    expect(isRetailBarcode("96385074")).toBe(true); // EAN-8
    expect(isRetailBarcode("036000291452")).toBe(true); // UPC-A
  });

  it("rejects the DDT document code that started this", () => {
    // Ristogamma delivery note 3.692 — 10 digits, not a product at all.
    expect(isRetailBarcode("2026016456")).toBe(false);
  });

  it("rejects codes of a plausible length with a bad check digit", () => {
    expect(isRetailBarcode("8000500310428")).toBe(false);
  });

  it("rejects alphanumeric internal references", () => {
    expect(isRetailBarcode("RD01GGDF")).toBe(false);
    expect(isRetailBarcode("4544180007")).toBe(false); // supplier article no.
  });

  it("ignores surrounding whitespace", () => {
    expect(isRetailBarcode("  8000500310427 ")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isRetailBarcode("")).toBe(false);
    expect(isRetailBarcode("   ")).toBe(false);
  });
});
