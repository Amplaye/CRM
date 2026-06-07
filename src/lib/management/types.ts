// Shared types for the management (controllo gestione) pure logic. Kept separate
// from src/lib/pos/types.ts (the ingestion contract) — these describe the
// CONSUMPTION side (food cost, P&L, inventory) the dashboards and assistant read.

/** A recipe line: how much of an ingredient a dish uses, in the ingredient's unit. */
export interface RecipeLine {
  ingredientId: string;
  qty: number;
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
  operatingMargin: number;
  operatingMarginPct: number | null;
}
