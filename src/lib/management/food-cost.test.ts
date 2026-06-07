import { describe, it, expect } from "vitest";
import { dishCost, foodCostPct, margin, isLowMargin, dishCostTable } from "@/lib/management/food-cost";
import type { Dish, RecipeLine } from "@/lib/management/types";

const costs = new Map<string, number>([
  ["flour", 0.001], // €/g
  ["tomato", 0.003],
  ["mozzarella", 0.008],
  ["egg", 0.3], // €/pz
]);

describe("dishCost", () => {
  it("sums recipe qty × unit cost", () => {
    const recipe: RecipeLine[] = [
      { ingredientId: "flour", qty: 250 }, // 0.25
      { ingredientId: "tomato", qty: 100 }, // 0.30
      { ingredientId: "mozzarella", qty: 125 }, // 1.00
    ];
    expect(dishCost(recipe, costs)).toEqual({ cost: 1.55, missing: [] });
  });

  it("reports ingredients with no known cost and excludes them from the total", () => {
    const recipe: RecipeLine[] = [
      { ingredientId: "flour", qty: 200 }, // 0.20
      { ingredientId: "basil", qty: 5 }, // unknown
    ];
    const r = dishCost(recipe, costs);
    expect(r.cost).toBe(0.2);
    expect(r.missing).toEqual(["basil"]);
  });
});

describe("foodCostPct / margin / isLowMargin", () => {
  it("computes % of price", () => {
    expect(foodCostPct(3, 12)).toBe(25);
    expect(foodCostPct(3, null)).toBeNull();
    expect(foodCostPct(3, 0)).toBeNull();
  });
  it("margin is price - cost", () => {
    expect(margin(3, 12)).toBe(9);
    expect(margin(3, null)).toBeNull();
  });
  it("low margin when pct above target", () => {
    expect(isLowMargin(4, 10, 30)).toBe(true); // 40% > 30%
    expect(isLowMargin(3, 10, 30)).toBe(false); // 30% not > 30%
    expect(isLowMargin(3, null, 30)).toBe(false); // unknown price → not flagged
  });
});

describe("dishCostTable", () => {
  const dishes: Dish[] = [
    { menuItemId: "pizza", name: "Margherita", price: 8 },
    { menuItemId: "pasta", name: "Carbonara", price: 12 },
    { menuItemId: "norecipe", name: "Caffè", price: 1.5 },
  ];
  const recipes = new Map<string, RecipeLine[]>([
    ["pizza", [{ ingredientId: "flour", qty: 250 }, { ingredientId: "tomato", qty: 100 }, { ingredientId: "mozzarella", qty: 200 }]], // 0.25+0.30+1.60=2.15 → 26.875%
    ["pasta", [{ ingredientId: "egg", qty: 2 }, { ingredientId: "flour", qty: 100 }]], // 0.6+0.1=0.7 → 5.83%
  ]);

  it("sorts worst food-cost% first; dishes without a recipe sink to the bottom", () => {
    const rows = dishCostTable(dishes, recipes, costs, 30);
    expect(rows.map((r) => r.menuItemId)).toEqual(["pizza", "pasta", "norecipe"]);
    expect(rows[2].noRecipe).toBe(true);
    expect(rows[2].foodCostPct).toBeNull();
  });

  it("flags low-margin rows against the target", () => {
    const rows = dishCostTable(dishes, recipes, costs, 20);
    const pizza = rows.find((r) => r.menuItemId === "pizza")!;
    expect(pizza.foodCostPct).toBeCloseTo(26.88, 1);
    expect(pizza.lowMargin).toBe(true); // 26.88% > 20%
  });
});
