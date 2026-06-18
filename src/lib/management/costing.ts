// Ingredient cost valuation. The DB trigger keeps current_unit_cost as
// last-price-wins (the most recent invoice price). These pure helpers let the UI
// offer the alternative a real kitchen usually wants — a weighted average over
// recent purchases — and read a price trend out of ingredient_cost_history,
// without changing the write path. Analysis only; deterministic and unit-tested.

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** One purchase lot: a quantity bought at a unit cost. */
export interface CostLot {
  qty: number;
  unitCost: number;
}

/** Weighted-average unit cost over lots: Σ(qty·cost) / Σ(qty). Null when there is
 * no positive quantity to weight by (then the caller falls back to last price). */
export function weightedAvgCost(lots: CostLot[]): number | null {
  let totalQty = 0;
  let totalSpend = 0;
  for (const l of lots) {
    if (!(l.qty > 0)) continue;
    totalQty += l.qty;
    totalSpend += l.qty * l.unitCost;
  }
  if (totalQty <= 0) return null;
  return round4(totalSpend / totalQty);
}

/** A point in an ingredient's cost history (one observation). */
export interface CostPoint {
  observedOn: string; // yyyy-mm-dd
  unitCost: number;
}

/** Summarise a cost history series (already filtered to one ingredient): the
 * first/last observed cost and the % change between them. Points may be in any
 * order; they're sorted by date here. Null deltas when fewer than two points or
 * the first cost is zero (no meaningful base to compare against). */
export function costTrend(points: CostPoint[]): {
  first: number | null;
  last: number | null;
  changePct: number | null;
  points: CostPoint[];
} {
  const sorted = [...points].sort((a, b) => a.observedOn.localeCompare(b.observedOn));
  if (sorted.length === 0) return { first: null, last: null, changePct: null, points: sorted };
  const first = sorted[0].unitCost;
  const last = sorted[sorted.length - 1].unitCost;
  const changePct = sorted.length >= 2 && first > 0 ? round2(((last - first) / first) * 100) : null;
  return { first: round4(first), last: round4(last), changePct, points: sorted };
}
