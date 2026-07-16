// Loyverse adapter — the FIRST real (non-stub) till. Loyverse is a free POS
// (loyverse.com) with a public REST API at https://api.loyverse.com/v1 and,
// crucially, an instantly-issued personal access token (Back Office → Settings →
// Access tokens), so it's the one POS we can actually integrate and test live
// today — no partner onboarding, no OAuth dance. The five Italian tills
// (cassa_in_cloud, tilby, …) stay stubs until their credentials arrive; this
// file is the worked example of what each will become.
//
// Mapping notes (Loyverse wire → canonical), so the contract is explicit:
//   • receipts          → CanonicalSale (one receipt = one bill)
//   • receipt_type      → "SALE" kept; "REFUND" skipped (negative receipts would
//                          double-count against the SALE they reverse; food cost
//                          and P&L want gross sales, refunds are handled upstream)
//   • dining_option     → channel: best-effort map ("Dine in"→sala,
//                          "Takeout"/"Take out"→asporto, "Delivery"→delivery);
//                          unknown/absent → sala (Loyverse's most common default)
//   • line_items[]      → CanonicalSaleItem; gross_total_money is the post-discount
//                          line total Loyverse reports, so we use it directly
//   • total_money       → grossTotal; total_tax → taxTotal; net = gross − tax
//   • payments[].money  → paymentMethod via the payment type's name (cash/card/…)
//   • covers            → null: Loyverse has no covers/coperti concept
//   • feesTotal         → 0: in-house POS, no aggregator commission
//   • Money fields are MAJOR units (euros), already decimal — no /100 needed
//     (unlike Square/Stripe). currency comes from the receipt/store.
//
// Credentials (decrypted by the orchestrator before calling): { access_token }.
// Config (non-secret pos_connections.config): { store_id?, currency? }.

import { posFetch } from "@/lib/pos/transport";
import type {
  AdapterContext,
  CanonicalProduct,
  CanonicalSale,
  CanonicalSaleItem,
  FetchSalesParams,
  PosAdapter,
  PosChannel,
  PosPaymentMethod,
  ProductUpsert,
  PushResult,
} from "@/lib/pos/types";

const BASE = "https://api.loyverse.com/v1.0";
// Loyverse caps page size at 250; we request the max to minimise round-trips.
const PAGE_LIMIT = 250;
// Hard ceiling on pages per fetch so a misbehaving cursor can never loop forever
// (250 × 200 = 50k receipts per window — far beyond any incremental sync).
const MAX_PAGES = 200;

// ---- wire types (only the fields we read) -----------------------------------
interface LvMoney {
  // Loyverse returns plain numbers in major currency units.
  [k: string]: unknown;
}
interface LvLineItem {
  item_name?: string | null;
  variant_id?: string | null;
  item_id?: string | null;
  quantity?: number | null;
  price?: number | null;
  gross_total_money?: number | null;
  total_money?: number | null;
  line_taxes?: Array<{ rate?: number | null }> | null;
}
interface LvPayment {
  payment_type_id?: string | null;
  name?: string | null;
  type?: string | null; // CASH / CARD / … on some accounts
  money?: number | null;
}
interface LvReceipt {
  receipt_number?: string | null;
  receipt_type?: string | null; // SALE | REFUND
  receipt_date?: string | null; // ISO 8601
  created_at?: string | null;
  cancelled_at?: string | null;
  total_money?: number | null;
  total_tax?: number | null;
  total_discount?: number | null;
  tip?: number | null;
  dining_option?: string | null;
  source?: string | null;
  currency?: string | null;
  store_id?: string | null;
  line_items?: LvLineItem[] | null;
  payments?: LvPayment[] | null;
}
interface LvReceiptsPage {
  receipts?: LvReceipt[] | null;
  cursor?: string | null;
}
interface LvVariant {
  variant_id?: string | null;
  sku?: string | null;
  default_price?: number | null;
}
interface LvItem {
  id?: string | null;
  item_name?: string | null;
  category_id?: string | null;
  variants?: LvVariant[] | null;
}
interface LvItemsPage {
  items?: LvItem[] | null;
  cursor?: string | null;
}
interface LvCategory {
  id?: string | null;
  name?: string | null;
}
interface LvCategoriesPage {
  categories?: LvCategory[] | null;
  cursor?: string | null;
}

// ---- helpers ----------------------------------------------------------------
function authHeaders(ctx: AdapterContext): HeadersInit {
  const token = ctx.credentials?.access_token;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Loyverse: access_token mancante nelle credenziali");
  }
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function businessDateOf(iso: string): string {
  // Service day = calendar day of the receipt date (already includes the store's
  // offset in the ISO string). Slice rather than new Date() to stay TZ-stable.
  return iso.slice(0, 10);
}

// dining_option is a free-text label set per merchant; match the common presets
// case-insensitively and fall back to sala (the POS default for seated venues).
function channelOf(diningOption: string | null | undefined): PosChannel {
  const s = (diningOption || "").toLowerCase();
  if (/take\s?out|takeaway|asporto|pickup|pick\s?up|to\s?go/.test(s)) return "asporto";
  if (/deliver|consegna|domicilio/.test(s)) return "delivery";
  if (/dine|tavolo|sala|here|eat\s?in/.test(s)) return "sala";
  return "sala";
}

// Map a Loyverse payment (by name/type) to the canonical method. Names are
// merchant-defined, so match keywords; unknown → "other".
function paymentMethodOf(payments: LvPayment[] | null | undefined): PosPaymentMethod | null {
  if (!payments || payments.length === 0) return null;
  // Pick the payment that moved the most money (the dominant tender on split bills).
  const main = [...payments].sort((a, b) => num(b.money) - num(a.money))[0];
  const s = `${main?.type || ""} ${main?.name || ""}`.toLowerCase();
  if (/cash|contant|efectiv/.test(s)) return "cash";
  if (/card|carta|credit|debit|tarjeta|visa|master/.test(s)) return "card";
  if (/online|paypal|stripe|web/.test(s)) return "online";
  if (/voucher|ticket|buono|meal/.test(s)) return "meal_voucher";
  if (/transfer|bonifico|bank/.test(s)) return "bank_transfer";
  return "other";
}

// Page /items once and find the item that owns a given variant_id. Loyverse
// keys catalogue writes by ITEM (an item holds N variants), but line items and
// inventory key by variant_id — so every write that targets one variant first
// has to locate its parent item. Shared by price/product/stock write-backs.
async function findItemByVariant(
  ctx: AdapterContext,
  variantId: string,
): Promise<LvItem | undefined> {
  const items = await pageAll<LvItem>(ctx, "/items", {}, (page: LvItemsPage) => ({
    rows: page.items ?? [],
    cursor: page.cursor ?? null,
  }));
  return items.find((it) => (it.variants ?? []).some((v) => v.variant_id === variantId));
}

// Make sure the item that owns `variantId` has track_stock=true, so Loyverse
// accepts a POST /inventory for it (it 400s otherwise — "track_stock set to
// false"). Idempotent: if it's already tracking, this is a no-op (we skip the
// re-POST). Returns false only when the item can't be found.
async function ensureTrackStock(ctx: AdapterContext, variantId: string): Promise<boolean> {
  const item = await findItemByVariant(ctx, variantId);
  if (!item || !item.id) return false;
  if ((item as any).track_stock === true) return true;
  await posFetch(`${BASE}/items`, {
    method: "POST",
    headers: { ...authHeaders(ctx), "Content-Type": "application/json" },
    body: JSON.stringify({ ...item, track_stock: true }),
  });
  return true;
}

// Resolve the store to write stock against: the configured store_id, else the
// account's first store (Loyverse inventory is per-store, so a store is required).
async function resolveStoreId(ctx: AdapterContext): Promise<string | undefined> {
  const configured = typeof ctx.config?.store_id === "string" ? ctx.config.store_id : undefined;
  if (configured) return configured;
  const res = await posFetch(`${BASE}/stores?limit=1`, { headers: authHeaders(ctx) });
  const data = (await res.json()) as { stores?: Array<{ id?: string }> };
  return data.stores?.[0]?.id || undefined;
}

// Ensure a category exists by name, returning its id (Loyverse items reference
// categories by id). Looks up the existing set first, creates it only if absent.
async function ensureCategoryId(ctx: AdapterContext, name: string): Promise<string | undefined> {
  const want = name.trim().toLowerCase();
  if (!want) return undefined;
  const cats = await pageAll<LvCategory>(ctx, "/categories", {}, (page: LvCategoriesPage) => ({
    rows: page.categories ?? [],
    cursor: page.cursor ?? null,
  }));
  const hit = cats.find((c) => (c.name || "").trim().toLowerCase() === want);
  if (hit?.id) return hit.id;
  const res = await posFetch(`${BASE}/categories`, {
    method: "POST",
    headers: { ...authHeaders(ctx), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const saved = (await res.json()) as LvCategory;
  return saved.id || undefined;
}

// Generic cursor pager: keeps calling `path` with the carried cursor until the
// API stops returning one (or the page cap trips), accumulating `pluck`ed rows.
async function pageAll<T>(
  ctx: AdapterContext,
  path: string,
  query: Record<string, string>,
  pluck: (page: any) => { rows: T[]; cursor: string | null },
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams({ ...query, limit: String(PAGE_LIMIT) });
    if (cursor) qs.set("cursor", cursor);
    const res = await posFetch(`${BASE}${path}?${qs.toString()}`, { headers: authHeaders(ctx) });
    const page = (await res.json()) as any;
    const { rows, cursor: next } = pluck(page);
    out.push(...rows);
    if (!next) return out;
    cursor = next;
  }
  return out;
}

// ---- adapter ----------------------------------------------------------------
export const loyverseAdapter: PosAdapter = {
  provider: "loyverse",

  async testConnection(ctx: AdapterContext): Promise<{ ok: true; detail?: string }> {
    // Cheapest authenticated call that proves the token works: one store.
    const res = await posFetch(`${BASE}/stores?limit=1`, { headers: authHeaders(ctx) });
    const data = (await res.json()) as { stores?: Array<{ name?: string }> };
    const name = data.stores?.[0]?.name;
    return { ok: true, detail: name ? `Connesso a Loyverse (negozio: ${name})` : "Connesso a Loyverse" };
  },

  async fetchSales(ctx: AdapterContext, p: FetchSalesParams): Promise<CanonicalSale[]> {
    const storeId = typeof ctx.config?.store_id === "string" ? ctx.config.store_id : undefined;
    const fallbackCurrency =
      typeof ctx.config?.currency === "string" ? (ctx.config.currency as string) : "EUR";

    const query: Record<string, string> = {
      created_at_min: p.since,
      created_at_max: p.until,
    };
    if (storeId) query.store_id = storeId;

    const receipts = await pageAll<LvReceipt>(ctx, "/receipts", query, (page: LvReceiptsPage) => ({
      rows: page.receipts ?? [],
      cursor: page.cursor ?? null,
    }));

    const sales: CanonicalSale[] = [];
    for (const r of receipts) {
      // Skip refunds (negative, reverse a prior SALE) and cancelled receipts.
      if ((r.receipt_type || "SALE").toUpperCase() === "REFUND") continue;
      if (r.cancelled_at) continue;

      const closedAt = r.receipt_date || r.created_at;
      if (!closedAt) continue;

      const items: CanonicalSaleItem[] = (r.line_items ?? []).map((li) => {
        const qty = num(li.quantity) || 1;
        const lineGross = round2(num(li.gross_total_money ?? li.total_money));
        const unitPrice = li.price != null ? round2(num(li.price)) : round2(lineGross / qty);
        const taxRate = li.line_taxes?.[0]?.rate;
        return {
          externalProductId: li.variant_id || li.item_id || null,
          name: li.item_name || "—",
          category: null, // categories are a separate resource; not joined per line
          quantity: qty,
          unitPrice,
          grossTotal: lineGross,
          taxRate: taxRate != null && Number.isFinite(taxRate) ? Number(taxRate) : null,
          raw: li,
        };
      });

      const grossTotal = round2(num(r.total_money));
      const taxTotal = round2(num(r.total_tax));
      const netTotal = round2(grossTotal - taxTotal);

      sales.push({
        externalId: r.receipt_number || `${closedAt}-${sales.length}`,
        channel: channelOf(r.dining_option),
        channelSource: null, // Loyverse doesn't expose the aggregator platform
        businessDate: businessDateOf(closedAt),
        closedAt,
        currency: r.currency || fallbackCurrency,
        grossTotal,
        netTotal,
        taxTotal,
        discountTotal: round2(num(r.total_discount)),
        feesTotal: 0,
        tipTotal: round2(num(r.tip)),
        covers: null,
        paymentMethod: paymentMethodOf(r.payments),
        orderRef: r.receipt_number || null,
        items,
        raw: r,
      });
    }
    return sales;
  },

  async fetchProducts(ctx: AdapterContext): Promise<CanonicalProduct[]> {
    // Build a category-id → name map first so each product carries a readable
    // category (the catalogue endpoint only gives category_id on the item).
    const categories = await pageAll<LvCategory>(ctx, "/categories", {}, (page: LvCategoriesPage) => ({
      rows: page.categories ?? [],
      cursor: page.cursor ?? null,
    }));
    const catName = new Map<string, string>();
    for (const c of categories) if (c.id && c.name) catName.set(c.id, c.name);

    const items = await pageAll<LvItem>(ctx, "/items", {}, (page: LvItemsPage) => ({
      rows: page.items ?? [],
      cursor: page.cursor ?? null,
    }));

    const products: CanonicalProduct[] = [];
    for (const it of items) {
      const category = it.category_id ? catName.get(it.category_id) ?? null : null;
      const variants = it.variants ?? [];
      if (variants.length === 0) {
        if (it.id) {
          products.push({ externalProductId: it.id, name: it.item_name || "—", category, price: null });
        }
        continue;
      }
      // One canonical product per variant (variant_id is what line items
      // reference, so this keeps externalProductId joinable to sales).
      for (const v of variants) {
        if (!v.variant_id) continue;
        products.push({
          externalProductId: v.variant_id,
          name: it.item_name || "—",
          category,
          price: v.default_price != null ? round2(num(v.default_price)) : null,
        });
      }
    }
    return products;
  },

  // WRITE-BACK: set a new price for one variant on Loyverse, so a price changed
  // in the CRM lands on the till. Loyverse has no "patch one variant" call — you
  // re-POST the whole item with the same id (an upsert). To avoid clobbering the
  // item's other fields (name, category, the OTHER variants, per-store prices),
  // we first GET the item, mutate only the target variant's price (default +
  // every store entry), and POST it back unchanged otherwise.
  async pushProductPrice(
    ctx: AdapterContext,
    p: { externalProductId: string; price: number },
  ): Promise<PushResult> {
    const price = round2(num(p.price));
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, detail: `Prezzo non valido: ${p.price}` };
    }

    // 1) Find the item that owns this variant_id. fetchProducts maps variant→item
    //    but drops the item id, so we page /items and locate it here.
    const item = await findItemByVariant(ctx, p.externalProductId);
    if (!item || !item.id) {
      return { ok: false, detail: `Prodotto ${p.externalProductId} non trovato su Loyverse` };
    }

    // 2) Mutate ONLY the target variant's price; leave everything else as-is.
    const variants = (item.variants ?? []).map((v: any) => {
      if (v.variant_id !== p.externalProductId) return v;
      const stores = Array.isArray(v.stores)
        ? v.stores.map((s: any) => ({ ...s, pricing_type: "FIXED", price }))
        : v.stores;
      return { ...v, default_pricing_type: "FIXED", default_price: price, stores };
    });

    // 3) Upsert the item back (POST with the existing id == update).
    const body = { ...item, variants };
    const res = await posFetch(`${BASE}/items`, {
      method: "POST",
      headers: { ...authHeaders(ctx), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const saved = (await res.json()) as LvItem;
    const newPrice = (saved.variants ?? []).find((v) => v.variant_id === p.externalProductId)?.default_price;
    return {
      ok: true,
      detail: `Prezzo aggiornato su Loyverse: ${item.item_name} → €${newPrice ?? price}`,
    };
  },

  // CREATE or RENAME a product. Loyverse's /items is an upsert keyed by item id:
  //   • create  (no externalProductId) → POST a new item; Loyverse mints the item
  //     id AND a variant id. We return the VARIANT id (the joinable id everything
  //     else uses) so the CRM links the dish immediately.
  //   • rename   (externalProductId set) → locate the parent item, change its name
  //     (and category if asked), keep every variant/price untouched, POST it back.
  async pushProduct(ctx: AdapterContext, p: ProductUpsert): Promise<PushResult> {
    const name = (p.name || "").trim();
    if (!name) return { ok: false, detail: "Nome prodotto mancante" };
    const categoryId = p.category ? await ensureCategoryId(ctx, p.category) : undefined;

    // ---- rename / update an existing product --------------------------------
    if (p.externalProductId) {
      const item = await findItemByVariant(ctx, p.externalProductId);
      if (!item || !item.id) {
        return { ok: false, detail: `Prodotto ${p.externalProductId} non trovato su Loyverse` };
      }
      const body: any = { ...item, item_name: name };
      if (categoryId) body.category_id = categoryId;
      const res = await posFetch(`${BASE}/items`, {
        method: "POST",
        headers: { ...authHeaders(ctx), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const saved = (await res.json()) as LvItem;
      return {
        ok: true,
        detail: `Prodotto aggiornato su Loyverse: ${saved.item_name || name}`,
        externalProductId: p.externalProductId,
      };
    }

    // ---- create a new product -----------------------------------------------
    // track_stock:true so the item is inventory-capable from the start — Loyverse
    // rejects a stock write (POST /inventory) on an item that doesn't track stock,
    // and a CRM-managed product almost always wants a giacenza.
    const variant: any = { default_pricing_type: "FIXED" };
    if (p.price != null) variant.default_price = round2(num(p.price));
    const body: any = { item_name: name, track_stock: true, variants: [variant] };
    if (categoryId) body.category_id = categoryId;
    const res = await posFetch(`${BASE}/items`, {
      method: "POST",
      headers: { ...authHeaders(ctx), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const saved = (await res.json()) as LvItem;
    const newVariantId = (saved.variants ?? [])[0]?.variant_id || undefined;
    if (!newVariantId) {
      return { ok: false, detail: "Loyverse non ha restituito l'id del nuovo prodotto" };
    }
    return {
      ok: true,
      detail: `Prodotto creato su Loyverse: ${saved.item_name || name}`,
      externalProductId: newVariantId,
    };
  },

  // SET on-hand stock for one variant at a store. Loyverse tracks inventory
  // per (variant, store); the write is POST /inventory with the NEW absolute
  // level in `stock_after` (not a delta). We resolve the store from config (or
  // the account's first store) since inventory is meaningless without one.
  async pushStock(
    ctx: AdapterContext,
    p: { externalProductId: string; quantity: number },
  ): Promise<PushResult> {
    // Validate the RAW input first (num() coerces NaN→0, which would mask a bad
    // value AND waste a /stores call), then resolve the store.
    const qty = typeof p.quantity === "string" ? Number(p.quantity) : p.quantity;
    if (qty == null || !Number.isFinite(qty) || qty < 0) {
      return { ok: false, detail: `Quantità non valida: ${p.quantity}` };
    }
    const storeId = await resolveStoreId(ctx);
    if (!storeId) return { ok: false, detail: "Nessun negozio Loyverse su cui scrivere la giacenza" };

    // Loyverse rejects inventory writes on items that don't track stock; flip the
    // flag on first (idempotent) so a correction always lands.
    const tracked = await ensureTrackStock(ctx, p.externalProductId);
    if (!tracked) return { ok: false, detail: `Prodotto ${p.externalProductId} non trovato su Loyverse` };

    const res = await posFetch(`${BASE}/inventory`, {
      method: "POST",
      headers: { ...authHeaders(ctx), "Content-Type": "application/json" },
      body: JSON.stringify({
        inventory_levels: [{ variant_id: p.externalProductId, store_id: storeId, stock_after: qty }],
      }),
    });
    const saved = (await res.json()) as { inventory_levels?: Array<{ stock_after?: number }> };
    const after = saved.inventory_levels?.[0]?.stock_after;
    return {
      ok: true,
      detail: `Giacenza aggiornata su Loyverse: ${after ?? qty}`,
    };
  },
};
