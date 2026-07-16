// Sync orchestrator — the bridge from an adapter's CanonicalSale[] into the
// canonical pos_sales / pos_sale_items tables. Idempotent by construction: it
// upserts on (tenant_id, provider, external_id) so re-running the same window
// never duplicates a bill. After each sale's lines land it depletes inventory
// (fn_consume_stock_for_sale_item) for any line mapped to a menu_item with a
// recipe, then records a pos_sync_log row and updates the connection's status.
//
// Always called with a SERVICE-ROLE client: it writes pos_sales/pos_sale_items
// (members are read-only there) and reads pos_credentials (members can't).

import { getAdapter } from "@/lib/pos/registry";
import { decryptCredentials } from "@/lib/pos/credentials";
import type { CanonicalSale, PosProvider } from "@/lib/pos/types";

export interface PosConnectionRow {
  id: string;
  tenant_id: string;
  provider: PosProvider;
  active: boolean;
  config: Record<string, unknown> | null;
  last_sync_at: string | null;
}

export interface SyncResult {
  connectionId: string;
  tenantId: string;
  provider: PosProvider;
  status: "ok" | "error";
  fetched: number;
  upserted: number;
  skipped: number;
  error?: string;
}

// Re-fetch a small overlap before last_sync_at so a bill closed right at the
// boundary is never missed; the idempotent upsert absorbs the re-seen rows.
const OVERLAP_MS = 6 * 60 * 60 * 1000; // 6h
// First-ever sync backfills this far so a fresh tenant immediately has history.
const COLD_START_DAYS = 21;

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function syncConnection(supabase: any, connection: PosConnectionRow): Promise<SyncResult> {
  const now = new Date();
  const until = now.toISOString();
  // First sync = cold start: backfill history for reporting (P&L/food cost) but
  // do NOT deplete current stock by weeks of past consumption — inventory is a
  // "today" snapshot, not history-derived. Only incremental syncs deplete.
  const isColdStart = !connection.last_sync_at;
  const since = connection.last_sync_at
    ? new Date(new Date(connection.last_sync_at).getTime() - OVERLAP_MS).toISOString()
    : new Date(now.getTime() - COLD_START_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const result: SyncResult = {
    connectionId: connection.id,
    tenantId: connection.tenant_id,
    provider: connection.provider,
    status: "ok",
    fetched: 0,
    upserted: 0,
    skipped: 0,
  };

  // open a log row
  const { data: logRow } = await supabase
    .from("pos_sync_log")
    .insert({
      tenant_id: connection.tenant_id,
      connection_id: connection.id,
      provider: connection.provider,
      trigger: "cron",
      status: "running",
      window_from: since,
      window_to: until,
    })
    .select("id")
    .single();
  const logId = logRow?.id;

  try {
    const adapter = getAdapter(connection.provider);
    const credentials = await decryptCredentials(supabase, connection.id);
    const ctx = {
      tenantId: connection.tenant_id,
      credentials,
      config: (connection.config || {}) as Record<string, unknown>,
    };

    const sales = await adapter.fetchSales(ctx, { since, until });
    result.fetched = sales.length;

    // Map external_product_id → menu_item_id once (so lines feed food cost and
    // stock depletion). The mapping table is the products catalogue joined to
    // menu_items by name (the seam the real product-mapping step will own).
    const productToMenuItem = await buildProductMap(supabase, connection.tenant_id, adapter, ctx);

    const batch = await ingestSalesBatch(supabase, connection, sales, productToMenuItem, !isColdStart);
    result.upserted = batch.inserted;
    result.skipped = batch.skipped;

    await supabase
      .from("pos_connections")
      .update({ last_sync_at: until, last_sync_status: "ok", last_error: null, updated_at: until })
      .eq("id", connection.id);

    if (logId) {
      await supabase
        .from("pos_sync_log")
        .update({
          status: "ok",
          sales_fetched: result.fetched,
          sales_upserted: result.upserted,
          sales_skipped: result.skipped,
          finished_at: new Date().toISOString(),
        })
        .eq("id", logId);
    }
  } catch (e: any) {
    result.status = "error";
    result.error = e?.message || String(e);
    await supabase
      .from("pos_connections")
      .update({ last_sync_status: "error", last_error: result.error, updated_at: new Date().toISOString() })
      .eq("id", connection.id);
    if (logId) {
      await supabase
        .from("pos_sync_log")
        .update({ status: "error", error: result.error, finished_at: new Date().toISOString() })
        .eq("id", logId);
    }
  }

  return result;
}

/** Build externalProductId → menu_item_id, matching the till catalogue against
 * the tenant's menu_items by case-insensitive name. Best-effort: unmatched
 * products simply leave menu_item_id null (the line still records revenue).
 *
 * PRICE SOURCE OF TRUTH (see docs/POS_PRICE_CONFLICT.md): this function links a
 * dish to its till product but DELIBERATELY never copies the till's price onto
 * menu_items.price. The CRM is authoritative for menu prices — the owner edits a
 * price here, we push it to the till (/api/pos/push-price). If we also pulled the
 * till price back on every sync, a stale till price would silently overwrite the
 * owner's CRM edit ("last writer wins" in the wrong direction). So we sync sales
 * (facts) but not prices (CRM-owned). Each line's actual sold price still lands on
 * pos_sale_items.unit_price as a historical record. */
async function buildProductMap(
  supabase: any,
  tenantId: string,
  adapter: ReturnType<typeof getAdapter>,
  ctx: { tenantId: string; credentials: Record<string, unknown>; config: Record<string, unknown> },
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let products;
  try {
    products = await adapter.fetchProducts(ctx);
  } catch {
    return map; // adapter without product listing → no mapping, lines still land
  }
  const { data: items } = await supabase
    .from("menu_items")
    .select("id, name, pos_external_product_id")
    .eq("tenant_id", tenantId);
  const byName = new Map<string, { id: string; linked: string | null }>();
  for (const it of items || []) byName.set(normalizeName(it.name), { id: it.id, linked: it.pos_external_product_id ?? null });
  // Persist the dish→till-product link the FIRST time we match it, so price
  // write-back later targets this exact product instead of re-matching by name.
  const toLink: Array<{ id: string; ext: string }> = [];
  for (const p of products) {
    const hit = byName.get(normalizeName(p.name));
    if (hit) {
      map.set(p.externalProductId, hit.id);
      if (hit.linked !== p.externalProductId) toLink.push({ id: hit.id, ext: p.externalProductId });
    }
  }
  // Best-effort: a failure here must never break the sale sync.
  await Promise.all(
    toLink.map((l) =>
      supabase.from("menu_items").update({ pos_external_product_id: l.ext }).eq("id", l.id).then(() => {}, () => {}),
    ),
  ).catch(() => {});
  return map;
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const CHUNK = 500;
function chunked<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Ingest a whole batch of sales idempotently in BULK — the difference between a
 * fast sync and a 9-minute one. Instead of ~5 sequential round trips per bill,
 * it does a handful of set-based queries:
 *   1. one SELECT of already-seen external_ids → split new vs skipped
 *   2. chunked bulk-INSERT of the new sales, returning their ids
 *   3. chunked bulk-INSERT of all their lines (menu_item_id mapped)
 *   4. ONE stock-depletion RPC per menu_item (sold qty summed across the batch),
 *      not one per line
 * Re-running the same window re-sees every external_id → 0 inserted, all skipped.
 */
async function ingestSalesBatch(
  supabase: any,
  connection: PosConnectionRow,
  sales: CanonicalSale[],
  productToMenuItem: Map<string, string>,
  depleteStock: boolean,
): Promise<{ inserted: number; skipped: number }> {
  if (sales.length === 0) return { inserted: 0, skipped: 0 };

  // 1. which external_ids do we already have?
  const seen = new Set<string>();
  for (const ids of chunked(sales.map((s) => s.externalId))) {
    const { data } = await supabase
      .from("pos_sales")
      .select("external_id")
      .eq("tenant_id", connection.tenant_id)
      .eq("provider", connection.provider)
      .in("external_id", ids);
    for (const r of data || []) seen.add(r.external_id);
  }
  const fresh = sales.filter((s) => !seen.has(s.externalId));
  const skipped = sales.length - fresh.length;
  if (fresh.length === 0) return { inserted: 0, skipped };

  // 2. bulk-insert the new sales, keep externalId → id
  const now = new Date().toISOString();
  const saleIdByExternal = new Map<string, string>();
  for (const group of chunked(fresh)) {
    const rows = group.map((sale) => ({
      tenant_id: connection.tenant_id,
      connection_id: connection.id,
      provider: connection.provider,
      external_id: sale.externalId,
      channel: sale.channel,
      channel_source: sale.channelSource,
      business_date: sale.businessDate,
      closed_at: sale.closedAt,
      currency: sale.currency,
      gross_total: sale.grossTotal,
      net_total: sale.netTotal,
      tax_total: sale.taxTotal,
      discount_total: sale.discountTotal,
      fees_total: sale.feesTotal,
      tip_total: sale.tipTotal,
      covers: sale.covers,
      payment_method: sale.paymentMethod,
      order_ref: sale.orderRef,
      raw_payload: sale.raw ?? {},
      updated_at: now,
    }));
    const { data } = await supabase
      .from("pos_sales")
      .upsert(rows, { onConflict: "tenant_id,provider,external_id" })
      .select("id, external_id");
    for (const r of data || []) saleIdByExternal.set(r.external_id, r.id);
  }

  // 3. build all line rows + accumulate stock depletion per menu_item
  const allLines: any[] = [];
  const soldByMenuItem = new Map<string, number>();
  for (const sale of fresh) {
    const saleId = saleIdByExternal.get(sale.externalId);
    if (!saleId) continue;
    for (const it of sale.items) {
      const menuItemId = it.externalProductId ? productToMenuItem.get(it.externalProductId) ?? null : null;
      allLines.push({
        tenant_id: connection.tenant_id,
        sale_id: saleId,
        external_product_id: it.externalProductId,
        name: it.name,
        category: it.category,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        gross_total: it.grossTotal,
        tax_rate: it.taxRate,
        menu_item_id: menuItemId,
        raw_payload: it.raw ?? {},
      });
      if (menuItemId) soldByMenuItem.set(menuItemId, (soldByMenuItem.get(menuItemId) || 0) + it.quantity);
    }
  }
  for (const group of chunked(allLines)) {
    if (group.length) await supabase.from("pos_sale_items").insert(group);
  }

  // 4. one stock-depletion call per dish (summed qty), not one per line.
  //    Skipped on a cold-start backfill (would rewind today's stock by weeks).
  if (depleteStock) {
    for (const [menuItemId, qty] of soldByMenuItem) {
      await supabase.rpc("fn_consume_stock_for_sale_item", {
        p_tenant_id: connection.tenant_id,
        p_menu_item_id: menuItemId,
        p_sold_qty: qty,
      });
    }
  }

  return { inserted: fresh.length, skipped };
}
