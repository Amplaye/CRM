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
// --c1..cN cascade, malformed slots ignored per-slot. Templates now expose
// more than three slots; the first three keep their historical meaning so a
// shorter (legacy 3-colour) override still resolves correctly.

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
  it("applies a full override (all slots)", () => {
    const base = SITE_TEMPLATE_DEFS.suerte.swatches;
    const full = base.map((_, i) => `#${String(i).repeat(6)}`);
    expect(resolvePalette("suerte", full)).toEqual(full);
  });
  it("returns one colour per swatch (length preserved)", () => {
    for (const key of Object.keys(SITE_TEMPLATE_DEFS) as (keyof typeof SITE_TEMPLATE_DEFS)[]) {
      expect(resolvePalette(key)).toHaveLength(SITE_TEMPLATE_DEFS[key].swatches.length);
    }
  });
  it("keeps extra slots at their defaults for a legacy 3-colour override", () => {
    const base = SITE_TEMPLATE_DEFS.suerte.swatches; // 6 slots now
    const resolved = resolvePalette("suerte", ["#111111", "#222222", "#333333"]);
    expect(resolved.slice(0, 3)).toEqual(["#111111", "#222222", "#333333"]);
    expect(resolved.slice(3)).toEqual(base.slice(3)); // untouched
  });
  it("falls back per-slot for malformed or missing colours", () => {
    const base = SITE_TEMPLATE_DEFS.suerte.swatches;
    // slot 0 valid, slot 1 garbage, the rest missing → defaults
    const resolved = resolvePalette("suerte", ["#0a0a0a", "not-a-color"]);
    expect(resolved[0]).toBe("#0a0a0a");
    expect(resolved.slice(1)).toEqual(base.slice(1));
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
    const upper = base.map((c) => c.toUpperCase());
    expect(paletteVars("suerte", upper)).toEqual({});
  });
  it("emits a higher-index var (c4+) when an extra slot changes", () => {
    const base = SITE_TEMPLATE_DEFS.suerte.swatches; // slot 3 = "Testo"
    const override = [...base];
    override[3] = "#010203";
    expect(paletteVars("suerte", override)).toEqual({ "--c4": "#010203" });
  });
});

describe("registry integrity", () => {
  it("has matching swatches/paletteLabels lengths and an in-range accentIndex", () => {
    for (const key of Object.keys(SITE_TEMPLATE_DEFS) as (keyof typeof SITE_TEMPLATE_DEFS)[]) {
      const def = SITE_TEMPLATE_DEFS[key];
      expect(def.swatches.length).toBe(def.paletteLabels.length);
      expect(def.swatches.length).toBeGreaterThanOrEqual(3);
      expect(def.accentIndex).toBeGreaterThanOrEqual(0);
      expect(def.accentIndex).toBeLessThan(def.swatches.length);
      // every swatch is a valid hex (so the editor's colour input can seed it)
      for (const c of def.swatches) expect(isHexColor(c)).toBe(true);
    }
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
    const override = ["#000000", "#abcdef", "#000000"];
    expect(paletteAccent("suerte", override)).toBe("#abcdef");
    expect(def.accentIndex).toBe(1);
  });
});
