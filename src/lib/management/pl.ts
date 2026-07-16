// P&L — pure aggregation over canonical sales plus food cost and labor. Revenue
// is ex-VAT (net_total when present, else gross_total). Operating margin nets out
// food cost, labor and aggregator fees. plByBand splits the same period into
// lunch vs dinner (food cost apportioned by each band's revenue share, since food
// cost is computed per dish over the whole period, not per bill).

import type { PlDelta, PlSummary, RecipeLine, SaleRow } from "@/lib/management/types";
import { dishCost } from "@/lib/management/food-cost";
import { shiftOf, type Shift } from "@/lib/management/time-buckets";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Revenue of a single sale (ex-VAT preferred). */
export function revenueOf(sale: SaleRow): number {
  return sale.netTotal ?? sale.grossTotal;
}

/**
 * Food cost of everything sold in a period: for each sold line that maps to a
 * dish with a recipe, cost = dishCost(recipe) × quantity. Lines without a recipe
 * are counted separately so the UI can warn that the food cost is partial.
 */
export function periodFoodCost(
  lines: Array<{ menuItemId: string | null; quantity: number }>,
  recipesByMenuItem: Map<string, RecipeLine[]>,
  costs: Map<string, number>,
): { foodCost: number; linesWithRecipe: number; linesWithoutRecipe: number } {
  let foodCost = 0;
  let withRecipe = 0;
  let without = 0;
  for (const line of lines) {
    const recipe = line.menuItemId ? recipesByMenuItem.get(line.menuItemId) : undefined;
    if (!recipe || recipe.length === 0) {
      without++;
      continue;
    }
    withRecipe++;
    foodCost += dishCost(recipe, costs).cost * line.quantity;
  }
  return { foodCost: round2(foodCost), linesWithRecipe: withRecipe, linesWithoutRecipe: without };
}

function summarize(sales: SaleRow[], foodCost: number, labor: number, overhead = 0): PlSummary {
  const revenue = round2(sales.reduce((s, x) => s + revenueOf(x), 0));
  const covers = sales.reduce((s, x) => s + (x.covers ?? 0), 0);
  const fees = round2(sales.reduce((s, x) => s + (x.feesTotal ?? 0), 0));
  const primeCost = round2(foodCost + labor);
  const operatingMargin = round2(revenue - foodCost - labor - fees - overhead);
  const pctOf = (n: number) => (revenue > 0 ? round2((n / revenue) * 100) : null);
  return {
    revenue,
    covers,
    avgTicket: covers > 0 ? round2(revenue / covers) : null,
    fees,
    foodCost: round2(foodCost),
    foodCostPct: pctOf(foodCost),
    labor: round2(labor),
    laborPct: pctOf(labor),
    primeCost,
    primeCostPct: pctOf(primeCost),
    foodCostPerCover: covers > 0 ? round2(foodCost / covers) : null,
    laborPerCover: covers > 0 ? round2(labor / covers) : null,
    overhead: round2(overhead),
    overheadPct: pctOf(overhead),
    operatingMargin,
    operatingMarginPct: pctOf(operatingMargin),
  };
}

/** P&L summary for a period. `overhead` is fixed cost (rent, utilities…) charged
 * to the window; pass 0 (the default) when the tenant has entered none. */
export function plSummary(sales: SaleRow[], foodCost: number, labor: number, overhead = 0): PlSummary {
  return summarize(sales, foodCost, labor, overhead);
}

/** Signed difference between two numbers, with a % change vs the previous value. */
export function plDelta(current: number, previous: number): PlDelta {
  return {
    abs: round2(current - previous),
    pct: previous !== 0 ? round2(((current - previous) / Math.abs(previous)) * 100) : null,
  };
}

/**
 * Split a period into lunch vs dinner. `laborByShift` is the labor cost already
 * attributed to each band (from labor_cost rows). The period food cost is
 * apportioned to each band by its share of revenue (food cost is per-dish over
 * the whole period; a per-band recompute isn't available without per-bill lines).
 */
export function plByBand(
  sales: SaleRow[],
  totalFoodCost: number,
  laborByShift: Record<Shift, number>,
  tz?: string,
): Record<Shift, PlSummary> {
  const lunch: SaleRow[] = [];
  const dinner: SaleRow[] = [];
  for (const s of sales) (shiftOf(s.closedAt, tz) === "lunch" ? lunch : dinner).push(s);

  const lunchRev = lunch.reduce((a, x) => a + revenueOf(x), 0);
  const dinnerRev = dinner.reduce((a, x) => a + revenueOf(x), 0);
  const total = lunchRev + dinnerRev;
  const lunchFood = total > 0 ? (totalFoodCost * lunchRev) / total : 0;
  const dinnerFood = total > 0 ? totalFoodCost - lunchFood : 0;

  return {
    lunch: summarize(lunch, lunchFood, laborByShift.lunch ?? 0),
    dinner: summarize(dinner, dinnerFood, laborByShift.dinner ?? 0),
  };
}
