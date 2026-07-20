import { describe, it, expect } from "vitest";
import {
  buildInsights,
  foodCostTotals,
  sortInsights,
  topProfitIds,
  suggestedPrice,
} from "./food-cost-insights";
import type { DishCostRow } from "./types";

// Minimal row factory — only the fields the insights layer reads.
function row(p: Partial<DishCostRow> & { menuItemId: string }): DishCostRow {
  return {
    name: p.menuItemId,
    price: null,
    cost: 0,
    foodCostPct: null,
    margin: null,
    lowMargin: false,
    noRecipe: false,
    incompleteCost: false,
    ...p,
  };
}

describe("suggestedPrice", () => {
  it("brings a dish to the target %, rounded up to 50c", () => {
    // cost 3, target 30% → 10.00
    expect(suggestedPrice(3, 30)).toBe(10);
    // cost 3.1, target 30% → 10.33.. → ceil to 10.50
    expect(suggestedPrice(3.1, 30)).toBe(10.5);
  });
  it("is 0 when it can't be computed", () => {
    expect(suggestedPrice(0, 30)).toBe(0);
    expect(suggestedPrice(3, 0)).toBe(0);
  });
});

describe("buildInsights", () => {
  const sold = new Map([["a", 100], ["b", 4]]);
  const rows = [
    row({ menuItemId: "a", price: 10, cost: 3, foodCostPct: 30, margin: 7, lowMargin: false }),
    row({ menuItemId: "b", price: 8, cost: 4, foodCostPct: 50, margin: 4, lowMargin: true }),
    row({ menuItemId: "c", price: null, cost: 2, noRecipe: true }), // no price, no recipe
  ];
  const ins = buildInsights(rows, sold, 30);

  it("computes profit = margin × unitsSold", () => {
    expect(ins[0].profit).toBe(700); // 7 × 100
    expect(ins[1].profit).toBe(16); // 4 × 4
    expect(ins[2].profit).toBeNull(); // no margin
  });

  it("computes revenue and recoverable for under-target sellers", () => {
    expect(ins[0].recoverable).toBe(0); // not under target
    // b: suggested = ceil(4/0.3 *2)/2 = ceil(26.66)/2... = 13.5; uplift 5.5 × 4 = 22
    expect(ins[1].suggested).toBe(13.5);
    expect(ins[1].recoverable).toBe(22);
  });

  it("defaults missing sales to 0, never NaN", () => {
    expect(ins[2].unitsSold).toBe(0);
    expect(ins[2].revenue).toBe(0);
    expect(ins[2].recoverable).toBe(0);
  });
});

describe("foodCostTotals", () => {
  const ins = buildInsights(
    [
      row({ menuItemId: "a", price: 10, cost: 3, foodCostPct: 30, margin: 7 }),
      row({ menuItemId: "b", price: 8, cost: 4, foodCostPct: 50, margin: 4, lowMargin: true }),
      row({ menuItemId: "c", cost: 2, noRecipe: true }),
    ],
    new Map([["a", 100], ["b", 4]]),
    30,
  );

  it("sums profit and recoverable, counts blind spots", () => {
    const t = foodCostTotals(ins);
    expect(t.totalProfit).toBe(716); // 700 + 16
    expect(t.totalRecoverable).toBe(22);
    expect(t.noRecipeCount).toBe(1);
    expect(t.actionableCount).toBe(1);
  });

  it("weights food cost % by revenue, not by dish count", () => {
    const t = foodCostTotals(ins);
    // rev a=1000 (pct 30), rev b=32 (pct 50) → (30*1000 + 50*32)/1032 ≈ 30.62
    expect(t.weightedFoodCostPct).toBeCloseTo(30.62, 1);
  });

  it("weighted pct is null with no revenue", () => {
    const empty = buildInsights([row({ menuItemId: "z", foodCostPct: 40, price: 5 })], new Map(), 30);
    expect(foodCostTotals(empty).weightedFoodCostPct).toBeNull();
  });
});

describe("sortInsights", () => {
  const ins = buildInsights(
    [
      row({ menuItemId: "star", price: 10, cost: 3, foodCostPct: 30, margin: 7 }),
      row({ menuItemId: "leak", price: 8, cost: 4, foodCostPct: 50, margin: 4, lowMargin: true }),
      row({ menuItemId: "blind", cost: 2, noRecipe: true }),
    ],
    new Map([["star", 100], ["leak", 50], ["blind", 10]]),
    30,
  );

  it("action order front-loads recoverable money, then blind spots", () => {
    const order = sortInsights(ins, "action").map((d) => d.menuItemId);
    expect(order[0]).toBe("leak"); // has recoverable money
    expect(order).toContain("blind");
    expect(order.indexOf("blind")).toBeLessThan(order.indexOf("star")); // blind spot before healthy dish
  });

  it("profit order ranks best-sellers first", () => {
    const order = sortInsights(ins, "profit").map((d) => d.menuItemId);
    expect(order[0]).toBe("star"); // 700
  });

  it("sold order ranks by volume", () => {
    expect(sortInsights(ins, "sold")[0].menuItemId).toBe("star");
  });
});

describe("topProfitIds", () => {
  it("returns the Pareto set carrying the top share of profit", () => {
    const ins = buildInsights(
      [
        row({ menuItemId: "big", price: 10, margin: 8 }),
        row({ menuItemId: "mid", price: 10, margin: 2 }),
        row({ menuItemId: "small", price: 10, margin: 1 }),
      ],
      new Map([["big", 100], ["mid", 10], ["small", 5]]),
      30,
    );
    // profits: big 800, mid 20, small 5 → total 825; 50% cut → just "big"
    const stars = topProfitIds(ins, 0.5);
    expect(stars.has("big")).toBe(true);
    expect(stars.has("mid")).toBe(false);
  });

  it("is empty when nobody makes a profit", () => {
    const ins = buildInsights([row({ menuItemId: "x", margin: null })], new Map(), 30);
    expect(topProfitIds(ins).size).toBe(0);
  });
});
