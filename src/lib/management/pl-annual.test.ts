import { describe, it, expect } from "vitest";
import { buildPlYear, isRentCategory, type PlYearInput } from "./pl-annual";

const m = (jan: number, feb: number) => {
  const a = new Array(12).fill(0);
  a[0] = jan; a[1] = feb;
  return a;
};

describe("buildPlYear", () => {
  const input: PlYearInput = {
    revenue: m(10000, 8000),
    covers: m(400, 320),
    openDays: m(25, 20),
    cogs: [
      { key: "food", label: "Food", monthly: m(2500, 2000) },
      { key: "beverage", label: "Beverage", monthly: m(500, 400) },
    ],
    labor: m(3000, 2600),
    structure: [{ key: "utenze", label: "Utenze", monthly: m(800, 800) }],
    rent: m(1200, 1200),
  };

  it("assembles the statement rows with € and %", () => {
    const y = buildPlYear(input);
    const byKey = Object.fromEntries(y.rows.map((r) => [r.key, r]));
    expect(byKey.revenue.monthly[0]).toBe(10000);
    expect(byKey.cogs.monthly[0]).toBe(3000); // 2500 + 500
    expect(byKey.cogs.pct[0]).toBe(30); // 3000 / 10000
    expect(byKey.cogs.children).toHaveLength(2);
    // margin Jan = 10000 - 3000 - 3000 - 800 - 1200 = 2000
    expect(byKey.margin.monthly[0]).toBe(2000);
    expect(byKey.margin.pct[0]).toBe(20);
    // Feb = 8000 - 2400 - 2600 - 800 - 1200 = 1000
    expect(byKey.margin.monthly[1]).toBe(1000);
  });

  it("computes totals and sales/day, guards zero-revenue months", () => {
    const y = buildPlYear(input);
    expect(y.revenueTotal).toBe(18000);
    expect(y.salesPerDay[0]).toBe(400); // 10000 / 25
    expect(y.salesPerDay[2]).toBe(0); // no open days
    const margin = y.rows.find((r) => r.key === "margin")!;
    expect(margin.total).toBe(3000);
    expect(margin.pct[2]).toBeNull(); // no revenue in March
  });

  it("detects rent categories across locales", () => {
    expect(isRentCategory("Affitto")).toBe(true);
    expect(isRentCategory("Rent")).toBe(true);
    expect(isRentCategory("Alquiler local")).toBe(true);
    expect(isRentCategory("Miete")).toBe(true);
    expect(isRentCategory("Utenze")).toBe(false);
  });
});
