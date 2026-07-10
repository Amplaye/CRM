import { describe, expect, it } from "vitest";
import {
  GIFT_MAX_CENTS,
  GIFT_MIN_CENTS,
  formatGiftCents,
  generateGiftCode,
  isValidGiftAmount,
  normalizeGiftCode,
} from "./gift-cards";

describe("generateGiftCode", () => {
  it("mints codes in the GIFT-XXXX-XXXX shape from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateGiftCode();
      expect(code).toMatch(/^GIFT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    }
  });

  it("never contains ambiguous glyphs (0, O, 1, I, L) in the random body", () => {
    for (let i = 0; i < 50; i++) {
      // Strip the fixed "GIFT-" prefix (which legitimately contains an I).
      expect(generateGiftCode().slice(5)).not.toMatch(/[01OIL]/);
    }
  });
});

describe("normalizeGiftCode", () => {
  it("round-trips a minted code", () => {
    const code = generateGiftCode();
    expect(normalizeGiftCode(code)).toBe(code);
  });

  it("repairs case, spaces and missing dashes", () => {
    expect(normalizeGiftCode("gift 7k2m q4xa")).toBe("GIFT-7K2M-Q4XA");
    expect(normalizeGiftCode("GIFT7K2MQ4XA")).toBe("GIFT-7K2M-Q4XA");
    expect(normalizeGiftCode(" gift-7K2M-q4xa ")).toBe("GIFT-7K2M-Q4XA");
  });

  it("rejects garbage", () => {
    expect(normalizeGiftCode("")).toBeNull();
    expect(normalizeGiftCode("BUONO-1234")).toBeNull();
    expect(normalizeGiftCode("GIFT-7K2M")).toBeNull();
    expect(normalizeGiftCode("GIFT-7K2M-Q4XA-EXTRA")).toBeNull();
  });
});

describe("isValidGiftAmount", () => {
  it("accepts the bounds and presets", () => {
    expect(isValidGiftAmount(GIFT_MIN_CENTS)).toBe(true);
    expect(isValidGiftAmount(GIFT_MAX_CENTS)).toBe(true);
    expect(isValidGiftAmount(5000)).toBe(true);
  });

  it("rejects out-of-bounds and non-integer cents", () => {
    expect(isValidGiftAmount(GIFT_MIN_CENTS - 1)).toBe(false);
    expect(isValidGiftAmount(GIFT_MAX_CENTS + 1)).toBe(false);
    expect(isValidGiftAmount(50.5)).toBe(false);
    expect(isValidGiftAmount(NaN)).toBe(false);
  });
});

describe("formatGiftCents", () => {
  it("formats whole euros without decimals and cents with two", () => {
    expect(formatGiftCents(5000)).toBe("50 €");
    expect(formatGiftCents(2550)).toBe("25.50 €");
    expect(formatGiftCents(5000, "CHF")).toBe("50 CHF");
  });
});
