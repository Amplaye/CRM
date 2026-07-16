import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures } from "@/lib/types/tenant-settings";
import { getFiscalContext, assertFiscal } from "@/lib/fiscal/server";
import { loadOrder, recomputeOrder, getCassaSettings } from "@/lib/cassa/server";
import { getSelfOrderConfig, foodUnlockAtMs, foodUnlocked } from "@/lib/self-order/config";
import { assertRateLimit } from "@/lib/rate-limit";
import type { MenuItemVariant } from "@/lib/types";
import { apiError } from "@/lib/api-error";

// PUBLIC self-order intake — the QR at the table points at /m/<slug>?table=<id>
// and that page POSTs here. The caller is an anonymous guest, so this endpoint
// trusts NOTHING from the client except menu_item ids, quantities, chosen
// variant NAMES and free-text notes:
//
//   • prices / VAT / station are re-derived server-side from menu_items —
//     a tampered payload can never change what gets charged;
//   • it can only APPEND draft lines (comanda_no 0 = the shared cassa cart):
//     never edit, remove or pay anything, never touch another table's bill;
//   • gated per tenant by settings.features.self_order_enabled;
//   • rate-limited per IP.
//
// Kitchen pacing (drinks-first): a guest may send DRINKS the instant they scan,
// but FOOD is locked for the first few minutes of the table's visit. The lock is
// per-table and its clock starts when the table's bill is first opened, so a wave
// of tables sitting down together produces staggered food orders instead of one
// burst the pass can't cook. What's a "drink" is the categories the owner flagged
// (settings.self_order.drink_category_ids); everything else is food. See
// src/lib/self-order/config.ts.
//
// The till no longer has to be opened by hand first: if no cassa session is open
// when the first table scans, this endpoint opens one (attributed to "QR"), so a
// guest never dead-ends on "call the staff" just because nobody tapped Open yet.
//
// The cassa dashboard is already subscribed to cassa_order_items realtime, so
// the guest's lines pop into the table's cart with zero cassa changes.

const MAX_LINES = 30;
const MAX_QTY = 20;

type OrderLine = { menu_item_id: string; qty: number; variant_names?: string[]; notes?: string };

export async function POST(req: NextRequest) {
  const rl = await assertRateLimit(req, "public:order", { max: 10, windowSecs: 60 });
  if (rl) return rl;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const tableId = typeof body?.table_id === "string" ? body.table_id.trim() : "";
  const rawLines: any[] = Array.isArray(body?.items) ? body.items : [];
  if (!slug || !tableId || rawLines.length === 0 || rawLines.length > MAX_LINES) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const svc = createServiceRoleClient();

  // Tenant by slug, live, with self-ordering switched on.
  const { data: tenant } = await svc
    .from("tenants")
    .select("id, status, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!getFeatures(tenant.settings as any).self_order_enabled) {
    return NextResponse.json({ error: "self_order_disabled" }, { status: 403 });
  }
  const selfOrder = getSelfOrderConfig(tenant.settings as any);

  // The same fiscal guard the till itself runs. This endpoint takes NO
  // authentication — it's a guest's phone scanning a QR on the table — so without
  // it a venue whose invoices legally come out of an external POS (or which has no
  // fiscal identity at all) could still have bills opened on a till that is not
  // allowed to issue them, by anyone who walks past.
  const fiscal = await getFiscalContext(svc, tenant.id);
  const denied = assertFiscal(fiscal);
  if (denied) return denied;

  // The table must belong to THIS tenant (the QR encodes the id, but never
  // trust it to be in-tenant).
  const { data: table } = await svc
    .from("restaurant_tables")
    .select("id, name")
    .eq("id", tableId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!table) return NextResponse.json({ error: "table_not_found" }, { status: 404 });

  // Orders land in the cassa cart, which needs an OPEN daily session. Unlike the
  // staff till, a guest can't be asked to open the register — so if none is open
  // we open one on their behalf, attributed to the QR flow. Race-safe: the DB has
  // a partial unique index (one open session per tenant), so two simultaneous
  // first-scans can't both create one — the loser's insert no-ops and we re-read.
  let sessionId = await getOpenSessionId(svc, tenant.id);
  if (!sessionId) {
    await svc
      .from("cassa_sessions")
      .insert({ tenant_id: tenant.id, opening_float: 0, opened_by: null, opened_by_name: "QR" })
      .then(() => undefined, () => undefined); // conflict (someone beat us) is fine
    sessionId = await getOpenSessionId(svc, tenant.id);
    if (!sessionId) return NextResponse.json({ error: "cassa_closed" }, { status: 409 });
  }

  // Parse the requested lines (ids + qty + variant names only).
  const lines: OrderLine[] = [];
  for (const raw of rawLines) {
    const id = typeof raw?.menu_item_id === "string" ? raw.menu_item_id : "";
    const qty = Math.round(Number(raw?.qty));
    if (!id || !Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) {
      return NextResponse.json({ error: "invalid_items" }, { status: 400 });
    }
    const variantNames = Array.isArray(raw?.variant_names)
      ? raw.variant_names.filter((v: unknown) => typeof v === "string").slice(0, 10)
      : [];
    lines.push({
      menu_item_id: id,
      qty,
      variant_names: variantNames,
      notes: typeof raw?.notes === "string" && raw.notes.trim() ? raw.notes.trim().slice(0, 200) : undefined,
    });
  }

  // Authoritative catalog lookup: price/VAT/station/variants AND category (to
  // tell drink from food) come from the DB, never the client.
  const ids = Array.from(new Set(lines.map((l) => l.menu_item_id)));
  const { data: menuItems } = await svc
    .from("menu_items")
    .select("id, name, price, available, vat_rate, station, variants, category_id")
    .eq("tenant_id", tenant.id)
    .in("id", ids);
  type CatalogItem = {
    id: string;
    name: string;
    price: number | null;
    available: boolean | null;
    vat_rate: number | null;
    station: string | null;
    variants: MenuItemVariant[] | null;
    category_id: string | null;
  };
  const byId = new Map<string, CatalogItem>(
    ((menuItems || []) as CatalogItem[]).map((m) => [m.id, m]),
  );

  const drinkCats = new Set(selfOrder.drink_category_ids);
  const isDrink = (item: CatalogItem) => item.category_id != null && drinkCats.has(item.category_id);

  const rows: any[] = [];
  let hasFood = false;
  for (const line of lines) {
    const item = byId.get(line.menu_item_id);
    if (!item || item.available === false || item.price == null) {
      return NextResponse.json({ error: "item_unavailable" }, { status: 409 });
    }
    if (!isDrink(item)) hasFood = true;
    const catalogVariants: MenuItemVariant[] = Array.isArray(item.variants) ? item.variants : [];
    const chosen: MenuItemVariant[] = [];
    for (const vn of line.variant_names || []) {
      const v = catalogVariants.find((cv) => cv.name === vn);
      if (!v) return NextResponse.json({ error: "invalid_variant" }, { status: 400 });
      chosen.push({ name: v.name, price_delta: Number(v.price_delta) || 0 });
    }
    const unit = Number(item.price) + chosen.reduce((s, v) => s + v.price_delta, 0);
    const vatRaw = Number(item.vat_rate);
    rows.push({
      tenant_id: tenant.id,
      menu_item_id: item.id,
      name: String(item.name).slice(0, 120),
      unit_price: Math.round(Math.max(0, unit) * 100) / 100,
      qty: line.qty,
      course: 1,
      comanda_no: 0,
      notes: line.notes ?? null,
      vat_rate: Number.isFinite(vatRaw) && vatRaw >= 0 && vatRaw <= 100 ? vatRaw : null,
      station: typeof item.station === "string" && item.station.trim() ? item.station : null,
      variants: chosen,
      status: "draft" as const,
    });
  }

  // One live bill per table (same rule as the staff route): reuse the open
  // order, else open one attributed to the QR flow. The open order's opened_at is
  // ALSO this table's cooldown clock — the food lock counts from the bill's birth.
  const { data: existing } = await svc
    .from("cassa_orders")
    .select("id, opened_at")
    .eq("tenant_id", tenant.id)
    .eq("table_id", table.id)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  const now = Date.now();

  // Food gate: an order that contains food is refused while this table's food is
  // still locked. Drinks-only orders always pass. A table with NO open bill yet is
  // opening it right now — so its clock starts at `now`, and a food-including first
  // order is locked unless the cooldown is effectively zero.
  if (hasFood) {
    const openedAtMs = existing?.opened_at ? new Date(existing.opened_at).getTime() : now;
    if (!foodUnlocked(openedAtMs, now)) {
      return NextResponse.json(
        {
          error: "food_locked",
          unlock_at: new Date(foodUnlockAtMs(openedAtMs)).toISOString(),
          cooldown_min: selfOrder.cooldown_min,
        },
        { status: 409 },
      );
    }
  }

  let orderId: string;
  if (existing) {
    orderId = existing.id;
  } else {
    const { coverCharge } = await getCassaSettings(svc, tenant.id);
    const { data: created, error: createErr } = await svc
      .from("cassa_orders")
      .insert({
        tenant_id: tenant.id,
        table_id: table.id,
        table_name: table.name || "",
        channel: "sala",
        covers: 0,
        cover_unit: coverCharge,
        opened_by: null,
        opened_by_name: "QR",
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return NextResponse.json({ error: "order_create_failed" }, { status: 500 });
    }
    orderId = created.id;
  }

  const { error: insertErr } = await svc
    .from("cassa_order_items")
    .insert(rows.map((r) => ({ ...r, order_id: orderId })));
  if (insertErr) return apiError(insertErr, { route: "public/order", publicMessage: "order_failed" });

  const loaded = await loadOrder(svc, orderId);
  if (loaded) await recomputeOrder(svc, loaded.order, loaded.items);

  return NextResponse.json({ ok: true, order_id: orderId, lines: rows.length });
}

/** The tenant's open daily cassa session id, or null. */
async function getOpenSessionId(
  svc: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
): Promise<string | null> {
  const { data } = await svc
    .from("cassa_sessions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .maybeSingle();
  return data?.id ?? null;
}
