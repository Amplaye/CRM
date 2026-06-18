import { describe, it, expect } from "vitest";
import { plSummary, plByBand, periodFoodCost, revenueOf, plDelta } from "@/lib/management/pl";
import type { RecipeLine, SaleRow } from "@/lib/management/types";

function sale(p: Partial<SaleRow>): SaleRow {
  return {
    businessDate: "2026-06-01",
    closedAt: "2026-06-01T13:00:00Z",
    channel: "sala",
    grossTotal: 110,
    netTotal: 100,
    feesTotal: 0,
    covers: 2,
    ...p,
  };
}

describe("revenueOf", () => {
  it("prefers net (ex-VAT) over gross", () => {
    expect(revenueOf(sale({ netTotal: 100, grossTotal: 110 }))).toBe(100);
    expect(revenueOf(sale({ netTotal: null, grossTotal: 110 }))).toBe(110);
  });
});

describe("plSummary", () => {
  it("computes revenue, covers, avg ticket, food/labor % and operating margin", () => {
    const sales = [
      sale({ netTotal: 100, covers: 2, feesTotal: 0 }),
      sale({ netTotal: 200, covers: 4, feesTotal: 0 }),
    ];
    const s = plSummary(sales, 90, 60); // revenue 300, food 90 (30%), labor 60 (20%)
    expect(s.revenue).toBe(300);
    expect(s.covers).toBe(6);
    expect(s.avgTicket).toBe(50);
    expect(s.foodCostPct).toBe(30);
    expect(s.laborPct).toBe(20);
    expect(s.operatingMargin).toBe(150); // 300 - 90 - 60 - 0
    expect(s.operatingMarginPct).toBe(50);
  });

  it("nets aggregator fees out of the operating margin", () => {
    const s = plSummary([sale({ netTotal: 100, covers: null, feesTotal: 25 })], 30, 10);
    expect(s.fees).toBe(25);
    expect(s.operatingMargin).toBe(35); // 100 - 30 - 10 - 25
    expect(s.avgTicket).toBeNull(); // no covers
  });

  it("reports prime cost, per-cover costs and overhead", () => {
    const s = plSummary([sale({ netTotal: 300, covers: 6, feesTotal: 0 })], 90, 60, 30);
    expect(s.primeCost).toBe(150); // food 90 + labor 60
    expect(s.primeCostPct).toBe(50); // 150 / 300
    expect(s.foodCostPerCover).toBe(15); // 90 / 6
    expect(s.laborPerCover).toBe(10); // 60 / 6
    expect(s.overhead).toBe(30);
    expect(s.overheadPct).toBe(10);
    expect(s.operatingMargin).toBe(120); // 300 - 90 - 60 - 0 - 30
  });
});

describe("plDelta", () => {
  it("computes absolute and % change vs the previous period", () => {
    expect(plDelta(120, 100)).toEqual({ abs: 20, pct: 20 });
    expect(plDelta(80, 100)).toEqual({ abs: -20, pct: -20 });
  });
  it("null % when the previous value is zero", () => {
    expect(plDelta(50, 0)).toEqual({ abs: 50, pct: null });
  });
});

describe("periodFoodCost", () => {
  const costs = new Map<string, number>([["a", 1], ["b", 2]]);
  const recipes = new Map<string, RecipeLine[]>([
    ["dish1", [{ ingredientId: "a", qty: 1 }, { ingredientId: "b", qty: 2 }]], // cost 5
  ]);
  it("sums dishCost × quantity for lines with a recipe; counts the rest", () => {
    const r = periodFoodCost(
      [
        { menuItemId: "dish1", quantity: 3 }, // 15
        { menuItemId: "dish2", quantity: 1 }, // no recipe
        { menuItemId: null, quantity: 2 }, // unmapped
      ],
      recipes,
      costs,
    );
    expect(r.foodCost).toBe(15);
    expect(r.linesWithRecipe).toBe(1);
    expect(r.linesWithoutRecipe).toBe(2);
  });
});

describe("plByBand", () => {
  it("splits lunch vs dinner and apportions food cost by revenue share", () => {
    const sales = [
      sale({ closedAt: "2026-06-01T13:00:00+02:00", netTotal: 100, covers: 2 }), // lunch
      sale({ closedAt: "2026-06-01T21:00:00+02:00", netTotal: 300, covers: 4 }), // dinner
    ];
    const bands = plByBand(sales, 80, { lunch: 20, dinner: 40 }, "Europe/Rome");
    // revenue 100 vs 300 → food 20 vs 60
    expect(bands.lunch.revenue).toBe(100);
    expect(bands.lunch.foodCost).toBe(20);
    expect(bands.lunch.labor).toBe(20);
    expect(bands.dinner.revenue).toBe(300);
    expect(bands.dinner.foodCost).toBe(60);
    expect(bands.dinner.labor).toBe(40);
  });
});
