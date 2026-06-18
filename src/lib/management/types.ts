// Shared types for the management (controllo gestione) pure logic. Kept separate
// from src/lib/pos/types.ts (the ingestion contract) — these describe the
// CONSUMPTION side (food cost, P&L, inventory) the dashboards and assistant read.

/** A recipe line: how much of an ingredient a dish uses, in the ingredient's unit. */
export interface RecipeLine {
  ingredientId: string;
  qty: number;
  /** Optional yield loss for THIS line, as a % (0–100): trim, peel, cook-off,
   * plate spill. The kitchen actually consumes more than `qty` to plate `qty`,
   * so the costed quantity is qty / (1 − wastePct/100). Absent/0 → no waste. */
  wastePct?: number;
}

/** One dish for the food-cost table. */
export interface Dish {
  menuItemId: string;
  name: string;
  price: number | null;
}

/** Result of costing a single dish. */
export interface DishCostResult {
  cost: number;
  /** ingredientIds in the recipe that have no known unit cost. */
  missing: string[];
}

/** A row in the food-cost table (one dish). */
export interface DishCostRow {
  menuItemId: string;
  name: string;
  price: number | null;
  cost: number;
  /** food cost as % of price, null when price is missing/zero. */
  foodCostPct: number | null;
  /** price − cost, null when price is missing. */
  margin: number | null;
  /** true when foodCostPct exceeds the tenant's target. */
  lowMargin: boolean;
  /** dish has no recipe at all. */
  noRecipe: boolean;
  /** recipe references ingredients without a cost → cost is understated. */
  incompleteCost: boolean;
}

/** A canonical sale, as the dashboards read it from pos_sales. */
export interface SaleRow {
  businessDate: string;           // yyyy-mm-dd
  closedAt: string;               // ISO 8601
  channel: "sala" | "asporto" | "delivery";
  grossTotal: number;
  netTotal: number | null;
  feesTotal: number;
  covers: number | null;
}

/** Aggregated P&L for a period (or one band). */
export interface PlSummary {
  revenue: number;
  covers: number;
  avgTicket: number | null;
  fees: number;
  foodCost: number;
  foodCostPct: number | null;
  labor: number;
  laborPct: number | null;
  /** food + labor — the restaurant "prime cost", the headline controllable cost. */
  primeCost: number;
  primeCostPct: number | null;
  /** food / labor cost per cover; null when there are no covers. */
  foodCostPerCover: number | null;
  laborPerCover: number | null;
  /** fixed overhead (rent, utilities…) charged to the period; 0 when none entered. */
  overhead: number;
  overheadPct: number | null;
  /** revenue − food − labor − fees − overhead. */
  operatingMargin: number;
  operatingMarginPct: number | null;
}

/** One signed difference between two PlSummary values (this period vs previous). */
export interface PlDelta {
  /** absolute change (this − previous). */
  abs: number;
  /** percentage change vs previous; null when previous is 0. */
  pct: number | null;
}
