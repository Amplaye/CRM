// Canonical, POS-agnostic types — the "universal socket".
//
// Everything downstream (sync orchestrator, food cost, P&L, assistant) speaks
// ONLY these types. Each till is an adapter that maps its own wire format onto
// CanonicalSale/CanonicalSaleItem; nothing downstream knows which till produced
// a row. Add a real till tomorrow = add an adapter with the same contract, zero
// downstream changes. Mirrors the single-resolution-point idiom of voice-provider.ts.

export type PosProvider =
  | "mock"
  | "cassa_in_cloud"
  | "tilby"
  | "ipratico"
  | "nempos"
  | "deliverect";

export type PosChannel = "sala" | "asporto" | "delivery";

export type PosPaymentMethod =
  | "cash"
  | "card"
  | "online"
  | "meal_voucher"
  | "bank_transfer"
  | "other";

export interface CanonicalSaleItem {
  externalProductId: string | null;
  name: string;
  category: string | null;
  quantity: number;
  unitPrice: number;
  grossTotal: number;
  taxRate: number | null;
  raw: unknown;
}

export interface CanonicalSale {
  externalId: string;
  channel: PosChannel;
  /** glovo/justeat/… for delivery, otherwise null. */
  channelSource: string | null;
  /** Service day (local), ISO yyyy-mm-dd. */
  businessDate: string;
  /** Bill-close timestamp, ISO 8601. */
  closedAt: string;
  currency: string;
  grossTotal: number;
  netTotal: number | null;
  taxTotal: number | null;
  discountTotal: number;
  /** Aggregator commission (0 for in-house POS). */
  feesTotal: number;
  tipTotal: number;
  /** Coperti: null for asporto/delivery. */
  covers: number | null;
  paymentMethod: PosPaymentMethod | null;
  orderRef: string | null;
  items: CanonicalSaleItem[];
  raw: unknown;
}

export interface CanonicalProduct {
  externalProductId: string;
  name: string;
  category: string | null;
  price: number | null;
}

export interface FetchSalesParams {
  /** ISO 8601 inclusive lower bound (closed_at). */
  since: string;
  /** ISO 8601 upper bound (closed_at). */
  until: string;
}

/** Everything an adapter needs at call time. Credentials are already decrypted
 * (the orchestrator reads + decrypts pos_credentials before handing them over);
 * config is the non-secret pos_connections.config blob (shop id, cursor…). */
export interface AdapterContext {
  tenantId: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
}

/** The contract every till implements. Five real adapters are stubs today; the
 * MockAdapter is the only one that produces data. */
export interface PosAdapter {
  readonly provider: PosProvider;
  testConnection(ctx: AdapterContext): Promise<{ ok: true; detail?: string }>;
  fetchSales(ctx: AdapterContext, p: FetchSalesParams): Promise<CanonicalSale[]>;
  fetchProducts(ctx: AdapterContext): Promise<CanonicalProduct[]>;
}
