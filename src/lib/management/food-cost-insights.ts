// Food-cost insights — the layer that turns a flat cost table into a to-do list.
//
// The base food-cost table (food-cost.ts) answers "what does each dish cost and
// what's its margin?". That's necessary but not actionable: a dish with a perfect
// margin sold twice matters far less than a mediocre one sold 400 times. These
// pure helpers fold in 30-day sales volume so the page can rank dishes by the
// money they actually make (or leak), not by an alphabetical or %-only order.
//
// All functions are total and deterministic — no dates, no I/O — so they unit-test
// cleanly and never throw on partial data (missing price, no recipe, zero sales).

import type { DishCostRow } from "@/lib/management/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Price that brings a dish exactly to the target food cost %, rounded UP to
 * 50 cents so the suggestion is always safe and menu-friendly. Shared with the
 * page's inline suggestion. Returns 0 when it can't be computed. */
export function suggestedPrice(cost: number, targetPct: number): number {
  if (!(cost > 0) || !(targetPct > 0)) return 0;
  return Math.ceil((cost / (targetPct / 100)) * 2) / 2;
}

/** One dish enriched with what it did over the sales window. */
export interface DishInsight extends DishCostRow {
  /** units sold in the window (0 when never sold / not tracked). */
  unitsSold: number;
  /** margin × unitsSold — the dish's actual contribution to profit. Null when
   *  margin is unknown (no price). */
  profit: number | null;
  /** revenue the dish generated in the window (price × unitsSold), for share-of-menu. */
  revenue: number;
  /** €/window recoverable by moving an under-target dish to its suggested price:
   *  (suggestedPrice − price) × unitsSold. 0 when not actionable or never sold. */
  recoverable: number;
  /** the target-hitting price, or null when the dish isn't under target. */
  suggested: number | null;
}

export type SortKey = "action" | "profit" | "pct" | "sold";

export interface FoodCostTotals {
  /** Σ margin×sold across all dishes with a known margin. */
  totalProfit: number;
  /** food cost % weighted by revenue (a big seller counts more). Null when no
   *  revenue at all. This is the *true* average the owner lives with. */
  weightedFoodCostPct: number | null;
  /** Σ recoverable across every under-target dish that actually sells — the
   *  headline "you're leaving €X/window on the table". */
  totalRecoverable: number;
  /** dishes with no recipe (blind spots). */
  noRecipeCount: number;
  /** dishes selling but under target — the actionable count. */
  actionableCount: number;
}

/** Enrich every cost row with its sales-driven numbers. `soldOf` maps
 *  menuItemId → units sold in the window (missing ⇒ 0). */
export function buildInsights(
  rows: DishCostRow[],
  soldOf: Map<string, number>,
  targetPct: number,
): DishInsight[] {
  return rows.map((r) => {
    const unitsSold = Math.max(0, soldOf.get(r.menuItemId) ?? 0);
    const profit = r.margin != null ? round2(r.margin * unitsSold) : null;
    const revenue = r.price != null ? round2(r.price * unitsSold) : 0;
    const suggested =
      r.lowMargin && r.cost > 0 ? suggestedPrice(r.cost, targetPct) : null;
    const uplift = suggested != null && r.price != null ? suggested - r.price : 0;
    const recoverable = uplift > 0 ? round2(uplift * unitsSold) : 0;
    return { ...r, unitsSold, profit, revenue, recoverable, suggested };
  });
}

/** Portfolio-level totals over the enriched rows. */
export function foodCostTotals(insights: DishInsight[]): FoodCostTotals {
  let totalProfit = 0;
  let totalRecoverable = 0;
  let noRecipeCount = 0;
  let actionableCount = 0;
  let revSum = 0;
  let weightedPctNum = 0;
  for (const d of insights) {
    if (d.profit != null) totalProfit += d.profit;
    totalRecoverable += d.recoverable;
    if (d.noRecipe) noRecipeCount++;
    if (d.recoverable > 0) actionableCount++;
    if (d.foodCostPct != null && d.revenue > 0) {
      revSum += d.revenue;
      weightedPctNum += d.foodCostPct * d.revenue;
    }
  }
  return {
    totalProfit: round2(totalProfit),
    totalRecoverable: round2(totalRecoverable),
    weightedFoodCostPct: revSum > 0 ? round2(weightedPctNum / revSum) : null,
    noRecipeCount,
    actionableCount,
  };
}

/** Rank menuItemIds by contribution to profit and return the set whose profit
 *  makes up the top `share` (0..1) of total profit — the "menu stars" that carry
 *  the business (a Pareto cut). Ties and zero/negative profit never qualify. */
export function topProfitIds(insights: DishInsight[], share = 0.5): Set<string> {
  const ranked = insights
    .filter((d) => (d.profit ?? 0) > 0)
    .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0));
  const total = ranked.reduce((s, d) => s + (d.profit ?? 0), 0);
  const stars = new Set<string>();
  if (total <= 0) return stars;
  let acc = 0;
  for (const d of ranked) {
    stars.add(d.menuItemId);
    acc += d.profit ?? 0;
    if (acc / total >= share) break;
  }
  return stars;
}

/** Sort a copy of the insights by the chosen key. `action` is the default:
 *  it front-loads the dishes where changing something makes money — under-target
 *  sellers by €recoverable, then blind spots (no recipe), then the rest by
 *  profit — so the top of the list is literally the to-do list. */
export function sortInsights(insights: DishInsight[], key: SortKey): DishInsight[] {
  const a = [...insights];
  switch (key) {
    case "profit":
      return a.sort((x, y) => (y.profit ?? -Infinity) - (x.profit ?? -Infinity));
    case "pct":
      return a.sort((x, y) => (y.foodCostPct ?? -Infinity) - (x.foodCostPct ?? -Infinity));
    case "sold":
      return a.sort((x, y) => y.unitsSold - x.unitsSold);
    case "action":
    default:
      return a.sort((x, y) => actionScore(y) - actionScore(x));
  }
}

/** Higher = more worth the owner's attention. Recoverable money dominates;
 *  blind spots (no recipe) rank just under any real recoverable amount so they
 *  don't bury actual leaks; everything else falls back to profit. */
function actionScore(d: DishInsight): number {
  if (d.recoverable > 0) return 1_000_000 + d.recoverable;
  if (d.noRecipe) return 500_000;
  return d.profit ?? -Infinity;
}
