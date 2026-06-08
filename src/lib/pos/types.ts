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
  | "deliverect"
  | "loyverse";

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

/** Result of a write-back to the till. `ok:false` carries a human-readable
 * reason the CRM can surface (e.g. "this till is read-only"). When a write
 * CREATES a product on the till, `externalProductId` is the id it was given, so
 * the CRM can persist the dish↔till link immediately (instead of waiting for the
 * next sync to re-match by name). */
export interface PushResult {
  ok: boolean;
  detail?: string;
  externalProductId?: string;
}

/** A product to create or rename on the till. `externalProductId` present =
 * rename/update that product; absent = create a new one (the till assigns the
 * id, returned in PushResult.externalProductId). `price`/`category` are optional
 * on create so the CRM can push just a name and fill the rest later. */
export interface ProductUpsert {
  externalProductId?: string;
  name: string;
  price?: number | null;
  category?: string | null;
}

/** The contract every till implements.
 *
 * READ side (mandatory): testConnection / fetchSales / fetchProducts — pull the
 * till's data into the canonical pos_sales tables. Every adapter must do this.
 *
 * WRITE side (optional): pushProductPrice / pushProduct / pushStock — push a
 * CHANGE made in the CRM back out to the till, so the owner manages everything
 * from the CRM and never opens the POS (the product vision). Each is optional so
 * a read-only or not-yet-implemented till simply omits it; callers check the
 * method exists before using it and report "not supported" otherwise. Loyverse
 * implements all three for real; the five Italian stubs don't yet. */
export interface PosAdapter {
  readonly provider: PosProvider;
  testConnection(ctx: AdapterContext): Promise<{ ok: true; detail?: string }>;
  fetchSales(ctx: AdapterContext, p: FetchSalesParams): Promise<CanonicalSale[]>;
  fetchProducts(ctx: AdapterContext): Promise<CanonicalProduct[]>;
  /** Push a new price for one product (identified by its external product id —
   * the same id fetchProducts returns) to the till. Optional: present only on
   * tills that support writing back. */
  pushProductPrice?(
    ctx: AdapterContext,
    p: { externalProductId: string; price: number },
  ): Promise<PushResult>;
  /** Create a product on the till (no externalProductId) or rename/retag an
   * existing one (externalProductId set). On create, PushResult.externalProductId
   * carries the new till id so the CRM can link the dish straight away. */
  pushProduct?(ctx: AdapterContext, p: ProductUpsert): Promise<PushResult>;
  /** Set the on-hand stock for one product at a store. `quantity` is the new
   * absolute level (not a delta). Used by the editable Magazzino so a stock
   * correction in the CRM reaches the till's inventory. */
  pushStock?(
    ctx: AdapterContext,
    p: { externalProductId: string; quantity: number },
  ): Promise<PushResult>;
}
