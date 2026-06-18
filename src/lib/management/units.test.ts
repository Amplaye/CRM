import { describe, it, expect } from "vitest";
import { convertQty, convertUnitCost, compatible, isUnit } from "@/lib/management/units";

describe("units", () => {
  it("recognises known units", () => {
    expect(isUnit("kg")).toBe(true);
    expect(isUnit("oz")).toBe(false);
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
