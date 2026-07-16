// Food cost — pure math. A dish's cost is the sum of (recipe qty × ingredient
// unit cost). Food cost % is that cost over the menu price; a dish is "low
// margin" when its food cost % exceeds the tenant's target (default 30%). All
// functions are total, deterministic and unit-tested before any UI exists.

import type { Dish, DishCostResult, DishCostRow, RecipeLine } from "@/lib/management/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Quantity actually consumed to plate `qty`, given a yield-loss % (trim/cook-off).
 * 25% waste means only 75% of what's bought reaches the plate, so consumption is
 * qty / 0.75. Guards keep it total: a missing, ≤0 or ≥100 waste falls back to qty. */
export function effectiveQty(qty: number, wastePct?: number): number {
  if (!wastePct || wastePct <= 0 || wastePct >= 100) return qty;
  return qty / (1 - wastePct / 100);
}

/** Cost of one dish from its recipe and a map of ingredientId → unit cost.
 * Each line's quantity is grossed up by its yield loss (wastePct). Ingredients
 * with no known cost are reported in `missing` and contribute 0 (cost is
 * understated, never inflated). */
export function dishCost(recipe: RecipeLine[], costs: Map<string, number>): DishCostResult {
  let cost = 0;
  const missing: string[] = [];
  for (const line of recipe) {
    const unit = costs.get(line.ingredientId);
    if (unit === undefined) {
      missing.push(line.ingredientId);
      continue;
    }
    cost += unit * effectiveQty(line.qty, line.wastePct);
  }
  return { cost: round2(cost), missing };
}

/** Food cost as a percentage of price. Null when price is missing or ≤ 0. */
export function foodCostPct(cost: number, price: number | null): number | null {
  if (price === null || price <= 0) return null;
  return round2((cost / price) * 100);
}

/** Margin in currency. Null when price is missing. */
export function margin(cost: number, price: number | null): number | null {
  if (price === null) return null;
  return round2(price - cost);
}

/** Whether a dish is below the target margin (food cost % above target). A dish
 * with no price can't be judged → not flagged. */
export function isLowMargin(cost: number, price: number | null, targetPct: number): boolean {
  const pct = foodCostPct(cost, price);
  if (pct === null) return false;
  return pct > targetPct;
}

/** Build the full food-cost table, sorted by food cost % descending (worst
 * first); dishes with no comparable % (no price/recipe) sink to the bottom. */
export function dishCostTable(
  dishes: Dish[],
  recipesByDish: Map<string, RecipeLine[]>,
  costs: Map<string, number>,
  targetPct: number,
): DishCostRow[] {
  const rows: DishCostRow[] = dishes.map((d) => {
    const recipe = recipesByDish.get(d.menuItemId) ?? [];
    const { cost, missing } = dishCost(recipe, costs);
    const noRecipe = recipe.length === 0;
    return {
      menuItemId: d.menuItemId,
      name: d.name,
      price: d.price,
      cost,
      foodCostPct: noRecipe ? null : foodCostPct(cost, d.price),
      margin: margin(cost, d.price),
      lowMargin: !noRecipe && isLowMargin(cost, d.price, targetPct),
      noRecipe,
      incompleteCost: missing.length > 0,
    };
  });
  rows.sort((a, b) => {
    if (a.foodCostPct === null && b.foodCostPct === null) return 0;
    if (a.foodCostPct === null) return 1;
    if (b.foodCostPct === null) return -1;
    return b.foodCostPct - a.foodCostPct;
  });
  return rows;
}
