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

    for (const sale of sales) {
      const upserted = await upsertSale(supabase, connection, sale, productToMenuItem);
      if (upserted) result.upserted++;
      else result.skipped++;
    }

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
 * products simply leave menu_item_id null (the line still records revenue). */
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
    .select("id, name")
    .eq("tenant_id", tenantId);
  const byName = new Map<string, string>();
  for (const it of items || []) byName.set(normalizeName(it.name), it.id);
  for (const p of products) {
    const id = byName.get(normalizeName(p.name));
    if (id) map.set(p.externalProductId, id);
  }
  return map;
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Upsert one sale + its lines. Returns true if the sale row was newly inserted
 * (so stock is depleted exactly once), false if it already existed (skipped). */
async function upsertSale(
  supabase: any,
  connection: PosConnectionRow,
  sale: CanonicalSale,
  productToMenuItem: Map<string, string>,
): Promise<boolean> {
  // Was it already ingested? (idempotency check before doing line/stock work)
  const { data: existing } = await supabase
    .from("pos_sales")
    .select("id")
    .eq("tenant_id", connection.tenant_id)
    .eq("provider", connection.provider)
    .eq("external_id", sale.externalId)
    .maybeSingle();

  const saleRow = {
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
    updated_at: new Date().toISOString(),
  };

  const { data: up } = await supabase
    .from("pos_sales")
    .upsert(saleRow, { onConflict: "tenant_id,provider,external_id" })
    .select("id")
    .single();
  const saleId = up?.id;
  if (!saleId) return false;

  if (existing) return false; // already had it → don't re-insert lines / re-deplete stock

  // Insert the lines (sale is new → no duplicates possible).
  const lines = sale.items.map((it) => ({
    tenant_id: connection.tenant_id,
    sale_id: saleId,
    external_product_id: it.externalProductId,
    name: it.name,
    category: it.category,
    quantity: it.quantity,
    unit_price: it.unitPrice,
    gross_total: it.grossTotal,
    tax_rate: it.taxRate,
    menu_item_id: it.externalProductId ? productToMenuItem.get(it.externalProductId) ?? null : null,
    raw_payload: it.raw ?? {},
  }));
  if (lines.length > 0) await supabase.from("pos_sale_items").insert(lines);

  // Deplete inventory for mapped dishes (no-op for lines without a recipe).
  for (const line of lines) {
    if (!line.menu_item_id) continue;
    await supabase.rpc("fn_consume_stock_for_sale_item", {
      p_tenant_id: connection.tenant_id,
      p_menu_item_id: line.menu_item_id,
      p_sold_qty: line.quantity,
    });
  }

  return true;
}
