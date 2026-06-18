// Inventory analysis — pure helpers for the two things the inventory screen can't
// do today: tell the owner WHAT TO REORDER, and reconcile what the recipes say
// SHOULD have been used against what was physically counted (the food-cost
// "variance", i.e. shrinkage from waste, theft, over-portioning or mis-recipes).

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface StockItem {
  ingredientId: string;
  name: string;
  unit: string;
  stockQty: number;
  parLevel: number;
  unitCost: number;
}

export interface ReorderLine {
  ingredientId: string;
  name: string;
  unit: string;
  stockQty: number;
  parLevel: number;
  /** quantity to buy to reach the reorder target (par × coverage). */
  suggestedQty: number;
  /** € to spend on this line at the current unit cost. */
  estimatedCost: number;
}

/**
 * Items at or below par become reorder lines. The suggested quantity tops the
 * item back up to `coverage × par` (default 2× par = a full par of buffer above
 * the minimum), never negative. Items with par 0 are skipped — no minimum set,
 * so we have no basis to suggest a quantity. Sorted by estimated spend desc.
 */
export function reorderList(items: StockItem[], coverage = 2): ReorderLine[] {
  const lines: ReorderLine[] = [];
  for (const it of items) {
    if (!(it.parLevel > 0)) continue;
    if (it.stockQty > it.parLevel) continue;
    const target = it.parLevel * coverage;
    const suggestedQty = round3(Math.max(0, target - it.stockQty));
    if (suggestedQty <= 0) continue;
    lines.push({
      ingredientId: it.ingredientId,
      name: it.name,
      unit: it.unit,
      stockQty: round3(it.stockQty),
      parLevel: round3(it.parLevel),
      suggestedQty,
      estimatedCost: round2(suggestedQty * it.unitCost),
    });
  }
  lines.sort((a, b) => b.estimatedCost - a.estimatedCost);
  return lines;
}

export interface VarianceLine {
  ingredientId: string;
  name: string;
  unit: string;
  /** quantity recipes say should have been consumed in the period. */
  theoretical: number;
  /** quantity actually consumed = opening + received − counted. */
  actual: number;
  /** actual − theoretical (positive = used MORE than recipes predict = loss). */
  variance: number;
  /** variance as % of theoretical; null when theoretical is 0. */
  variancePct: number | null;
  /** € value of the variance at the ingredient's unit cost. */
  varianceCost: number;
}

export interface VarianceInput {
  ingredientId: string;
  name: string;
  unit: string;
  unitCost: number;
  /** stock at the start of the period. */
  opening: number;
  /** quantity received (goods receipts / invoices) in the period. */
  received: number;
  /** physically counted stock at the end of the period. */
  counted: number;
  /** theoretical consumption from sold dishes × recipes. */
  theoretical: number;
}

/**
 * Per-ingredient consumption variance. Actual usage is derived by the inventory
 * identity: actual = opening + received − counted. Compared to the theoretical
 * usage the recipes predict, a positive variance means more was consumed than
 * sold dishes account for (shrinkage); negative means less (over-counting, or a
 * recipe that overstates portions). Lines are sorted by absolute € impact.
 */
export function consumptionVariance(input: VarianceInput[]): VarianceLine[] {
  const lines = input.map((i) => {
    const actual = round3(i.opening + i.received - i.counted);
    const variance = round3(actual - i.theoretical);
    const variancePct = i.theoretical > 0 ? round2((variance / i.theoretical) * 100) : null;
    return {
      ingredientId: i.ingredientId,
      name: i.name,
      unit: i.unit,
      theoretical: round3(i.theoretical),
      actual,
      variance,
      variancePct,
      varianceCost: round2(variance * i.unitCost),
    };
  });
  lines.sort((a, b) => Math.abs(b.varianceCost) - Math.abs(a.varianceCost));
  return lines;
}
