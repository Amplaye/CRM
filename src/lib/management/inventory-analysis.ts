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
export interface MovementLite {
  ingredientId: string;
  /** signed delta as stored in stock_movements. */
  qtyDelta: number;
  kind: string; // sale | receipt | count | waste | adjustment
  /** ISO timestamp of the movement. */
  createdAt: string;
}

export interface ParSuggestion {
  ingredientId: string;
  /** average daily consumption observed in the window. */
  avgDaily: number;
  /** suggested par level = avgDaily × coverDays. */
  suggestedPar: number;
}

/**
 * Data-driven par levels: look at real consumption (sales + waste, i.e. every
 * negative outflow except corrections) over the window and suggest a minimum
 * stock that covers `coverDays` of typical usage. The window adapts to young
 * datasets — if the first movement is more recent than `windowDays`, the daily
 * average divides by the days actually observed (floored at 3 so one busy
 * evening doesn't set a wild par). Ingredients with no consumption are omitted:
 * no data, no suggestion.
 */
export function suggestParLevels(
  movements: MovementLite[],
  opts: { now: Date; windowDays?: number; coverDays?: number } = { now: new Date() },
): ParSuggestion[] {
  const windowDays = opts.windowDays ?? 30;
  const coverDays = opts.coverDays ?? 3;
  const cutoff = opts.now.getTime() - windowDays * 86400000;

  const consumed = new Map<string, number>();
  let firstTs = opts.now.getTime();
  for (const m of movements) {
    const ts = new Date(m.createdAt).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    if (ts < firstTs) firstTs = ts;
    if ((m.kind === "sale" || m.kind === "waste") && m.qtyDelta < 0) {
      consumed.set(m.ingredientId, (consumed.get(m.ingredientId) || 0) + Math.abs(m.qtyDelta));
    }
  }
  const observedDays = Math.min(windowDays, Math.max(3, (opts.now.getTime() - firstTs) / 86400000));

  const out: ParSuggestion[] = [];
  for (const [ingredientId, total] of consumed) {
    if (!(total > 0)) continue;
    const avgDaily = total / observedDays;
    out.push({
      ingredientId,
      avgDaily: round3(avgDaily),
      suggestedPar: round3(avgDaily * coverDays),
    });
  }
  return out;
}

export interface ShrinkageLine {
  ingredientId: string;
  name: string;
  unit: string;
  /** net quantity lost (negative) or recovered (positive) in the window. */
  qty: number;
  /** € value of that net delta at the current unit cost (negative = money lost). */
  cost: number;
}

export interface ShrinkageSummary {
  lines: ShrinkageLine[];
  /** total € impact across all lines (negative = net loss). */
  totalCost: number;
}

/**
 * Where stock silently disappears: waste, physical-count corrections and manual
 * adjustments (sales and goods receipts are the *expected* flows and excluded).
 * Net per-ingredient delta valued at current unit cost, worst € impact first —
 * the "how much did we throw away this month" panel, computed from the ledger
 * with zero extra bookkeeping.
 */
export function shrinkageSummary(
  movements: MovementLite[],
  ingredients: Array<{ id: string; name: string; unit: string; unitCost: number }>,
  opts: { now: Date; windowDays?: number } = { now: new Date() },
): ShrinkageSummary {
  const windowDays = opts.windowDays ?? 30;
  const cutoff = opts.now.getTime() - windowDays * 86400000;
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const net = new Map<string, number>();
  for (const m of movements) {
    if (m.kind !== "waste" && m.kind !== "count" && m.kind !== "adjustment") continue;
    const ts = new Date(m.createdAt).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    net.set(m.ingredientId, (net.get(m.ingredientId) || 0) + m.qtyDelta);
  }

  const lines: ShrinkageLine[] = [];
  for (const [id, qty] of net) {
    const ing = byId.get(id);
    if (!ing || Math.abs(qty) < 0.0005) continue;
    lines.push({
      ingredientId: id,
      name: ing.name,
      unit: ing.unit,
      qty: round3(qty),
      cost: round2(qty * ing.unitCost),
    });
  }
  lines.sort((a, b) => a.cost - b.cost);
  return { lines, totalCost: round2(lines.reduce((s, l) => s + l.cost, 0)) };
}

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
