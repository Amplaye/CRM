import { describe, it, expect } from "vitest";
import {
  isHexColor,
  resolvePalette,
  paletteVars,
  paletteAccent,
  SITE_TEMPLATE_DEFS,
} from "./registry";

// The palette helpers drive the per-template colour override: unset → the
// template's built-in swatches (byte-identical output), a valid override →
// --c1/2/3 cascade, malformed slots ignored per-slot.

describe("isHexColor", () => {
  it("accepts 3- and 6-digit hex", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#AABBCC")).toBe(true);
    expect(isHexColor("  #123abc  ")).toBe(true); // trimmed
  });
  it("rejects anything else", () => {
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#12")).toBe(false);
    expect(isHexColor("#1234")).toBe(false);
    expect(isHexColor("rgb(0,0,0)")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(123 as unknown)).toBe(false);
  });
});

describe("resolvePalette", () => {
  it("returns the built-in swatches when there is no override", () => {
    for (const key of Object.keys(SITE_TEMPLATE_DEFS) as (keyof typeof SITE_TEMPLATE_DEFS)[]) {
      expect(resolvePalette(key)).toEqual(SITE_TEMPLATE_DEFS[key].swatches);
      expect(resolvePalette(key, null)).toEqual(SITE_TEMPLATE_DEFS[key].swatches);
      expect(resolvePalette(key, [])).toEqual(SITE_TEMPLATE_DEFS[key].swatches);
    }
  });
  it("applies a full override", () => {
    expect(resolvePalette("suerte", ["#111111", "#222222", "#333333"])).toEqual([
      "#111111",
      "#222222",
      "#333333",
    ]);
  });
  it("falls back per-slot for malformed or missing colours", () => {
    const base = SITE_TEMPLATE_DEFS.suerte.swatches;
    // slot 0 valid, slot 1 garbage, slot 2 missing
    expect(resolvePalette("suerte", ["#0a0a0a", "not-a-color"])).toEqual([
      "#0a0a0a",
      base[1],
      base[2],
    ]);
  });
});

describe("paletteVars", () => {
  it("emits nothing when the palette equals the built-in swatches", () => {
    const key = "vasco";
    expect(paletteVars(key)).toEqual({});
    expect(paletteVars(key, SITE_TEMPLATE_DEFS[key].swatches)).toEqual({});
  });
  it("emits only the vars that actually changed", () => {
    const base = SITE_TEMPLATE_DEFS.suerte.swatches;
    // change only c2
    expect(paletteVars("suerte", [base[0], "#ff0000", base[2]])).toEqual({ "--c2": "#ff0000" });
  });
  it("is case-insensitive when comparing to swatches", () => {
    const base = SITE_TEMPLATE_DEFS.suerte.swatches;
    const upper = base.map((c) => c.toUpperCase()) as [string, string, string];
    expect(paletteVars("suerte", upper)).toEqual({});
  });
});

describe("paletteAccent", () => {
  it("returns the template's accent swatch by default", () => {
    for (const key of Object.keys(SITE_TEMPLATE_DEFS) as (keyof typeof SITE_TEMPLATE_DEFS)[]) {
      const def = SITE_TEMPLATE_DEFS[key];
      expect(paletteAccent(key)).toBe(def.swatches[def.accentIndex]);
      // and it matches the legacy hard-coded accent field
      expect(paletteAccent(key).toLowerCase()).toBe(def.accent.toLowerCase());
    }
  });
  it("follows a recoloured accent", () => {
    const def = SITE_TEMPLATE_DEFS.suerte; // accentIndex 1
    const override = ["#000000", "#abcdef", "#000000"] as [string, string, string];
    expect(paletteAccent("suerte", override)).toBe("#abcdef");
    expect(def.accentIndex).toBe(1);
  });
});
