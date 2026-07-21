import { describe, it, expect } from "vitest";
import {
  convertQty,
  convertUnitCost,
  compatible,
  isUnit,
  ALL_UNITS,
  UNITS,
  UNIT_OPTIONS,
} from "@/lib/management/units";

describe("units", () => {
  it("recognises known units", () => {
    expect(isUnit("kg")).toBe(true);
    // "oz" used to be unknown; the catalogue now covers it. Only genuine
    // nonsense should be rejected.
    expect(isUnit("oz")).toBe(true);
    expect(isUnit("furlong")).toBe(false);
    expect(isUnit("")).toBe(false);
  });

  it("converts quantities within a dimension", () => {
    expect(convertQty(2, "kg", "g")).toBe(2000);
    expect(convertQty(500, "g", "kg")).toBe(0.5);
    expect(convertQty(1.5, "l", "ml")).toBe(1500);
    expect(convertQty(3, "pz", "pz")).toBe(3);
  });

  it("refuses to convert across dimensions", () => {
    expect(convertQty(1, "l", "g")).toBeNull();
    expect(convertQty(1, "kg", "ml")).toBeNull();
    expect(convertQty(1, "pz", "g")).toBeNull();
  });

  it("converts unit cost inversely to quantity", () => {
    expect(convertUnitCost(2, "kg", "g")).toBe(0.002); // €2/kg = €0.002/g
    expect(convertUnitCost(0.002, "g", "kg")).toBe(2);
    expect(convertUnitCost(1, "l", "g")).toBeNull();
  });

  it("compatible() groups by dimension", () => {
    expect(compatible("g", "kg")).toBe(true);
    expect(compatible("ml", "l")).toBe(true);
    expect(compatible("g", "ml")).toBe(false);
  });
});

// The widened catalogue: every unit a delivery note might carry, so nobody has
// to convert in their head (and slip a decimal doing it).
describe("extended unit catalogue", () => {
  it("recognises the added metric units", () => {
    for (const u of ["mg", "hg", "q", "t", "cl", "dl"]) expect(isUnit(u)).toBe(true);
  });

  it("recognises imperial and kitchen-spoon units", () => {
    for (const u of ["oz", "lb", "tsp", "tbsp", "cup", "floz", "pt", "gal"]) {
      expect(isUnit(u)).toBe(true);
    }
  });

  it("recognises packaging units", () => {
    for (const u of ["cf", "ct", "bt", "vas", "bus", "sac", "dz", "porz"]) {
      expect(isUnit(u)).toBe(true);
    }
  });

  it("converts across the new metric steps", () => {
    expect(convertQty(1, "kg", "hg")).toBe(10);
    expect(convertQty(1, "hg", "g")).toBe(100);
    expect(convertQty(2500, "mg", "g")).toBe(2.5);
    expect(convertQty(1, "q", "kg")).toBe(100);
    expect(convertQty(1, "t", "kg")).toBe(1000);
    expect(convertQty(1, "l", "cl")).toBe(100);
    expect(convertQty(1, "l", "dl")).toBe(10);
  });

  it("converts imperial and spoons into metric", () => {
    expect(convertQty(1, "lb", "g")).toBeCloseTo(453.59237, 5);
    expect(convertQty(1, "oz", "g")).toBeCloseTo(28.3495, 3);
    expect(convertQty(1, "tbsp", "ml")).toBe(15);
    expect(convertQty(3, "tsp", "ml")).toBe(15); // 3 tsp = 1 tbsp
    expect(convertQty(1, "gal", "l")).toBeCloseTo(3.785411784, 6);
  });

  it("keeps a dozen a fixed count but leaves packaging unconverted", () => {
    expect(convertQty(2, "dz", "pz")).toBe(24);
    // A "confezione" holds no fixed number of pieces, so it counts 1:1 rather
    // than pretending to know the pack size.
    expect(convertQty(3, "cf", "pz")).toBe(3);
  });

  it("still refuses to cross dimensions with the new units", () => {
    expect(convertQty(1, "lb", "l")).toBeNull();
    expect(convertQty(1, "tbsp", "g")).toBeNull();
    expect(convertQty(1, "cf", "kg")).toBeNull();
  });

  it("converts cost inversely for the new units too", () => {
    expect(convertUnitCost(10, "kg", "hg")).toBe(1); // €10/kg = €1/hg
    expect(convertUnitCost(1, "l", "cl")).toBeCloseTo(0.01, 10);
  });

  it("every catalogued unit is offered exactly once in the picker", () => {
    const listed = UNIT_OPTIONS.flatMap((g) => g.units);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...ALL_UNITS].sort());
  });

  it("every picker group only lists units of its own dimension", () => {
    for (const group of UNIT_OPTIONS) {
      for (const u of group.units) expect(UNITS[u].base).toBe(group.dimension);
    }
  });
});
