import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures } from "@/lib/types/tenant-settings";
import { loadOrder, recomputeOrder, getCassaSettings } from "@/lib/cassa/server";
import { assertRateLimit } from "@/lib/rate-limit";
import type { MenuItemVariant } from "@/lib/types";

// PUBLIC self-order intake — the QR at the table points at /m/<slug>?table=<id>
// and that page POSTs here. The caller is an anonymous guest, so this endpoint
// trusts NOTHING from the client except menu_item ids, quantities, chosen
// variant NAMES and free-text notes:
//
//   • prices / VAT / station are re-derived server-side from menu_items —
//     a tampered payload can never change what gets charged;
//   • it can only APPEND draft lines (comanda_no 0 = the shared cassa cart):
//     never edit, remove or pay anything, never touch another table's bill;
//   • gated per tenant by settings.features.self_order_enabled AND an OPEN
//     cassa session (staff must be working the till to receive orders);
//   • rate-limited per IP.
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

  // The table must belong to THIS tenant (the QR encodes the id, but never
  // trust it to be in-tenant).
  const { data: table } = await svc
    .from("restaurant_tables")
    .select("id, name")
    .eq("id", tableId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!table) return NextResponse.json({ error: "table_not_found" }, { status: 404 });

  // Orders land in the cassa cart → someone must be working the till.
  const { data: session } = await svc
    .from("cassa_sessions")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("status", "open")
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "cassa_closed" }, { status: 409 });

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

  // Authoritative catalog lookup: price/VAT/station/variants come from the DB.
  const ids = Array.from(new Set(lines.map((l) => l.menu_item_id)));
  const { data: menuItems } = await svc
    .from("menu_items")
    .select("id, name, price, available, vat_rate, station, variants")
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
  };
  const byId = new Map<string, CatalogItem>(
    ((menuItems || []) as CatalogItem[]).map((m) => [m.id, m]),
  );

  const rows: any[] = [];
  for (const line of lines) {
    const item = byId.get(line.menu_item_id);
    if (!item || item.available === false || item.price == null) {
      return NextResponse.json({ error: "item_unavailable" }, { status: 409 });
    }
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
  // order, else open one attributed to the QR flow.
  let orderId: string;
  const { data: existing } = await svc
    .from("cassa_orders")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("table_id", table.id)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
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
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  const loaded = await loadOrder(svc, orderId);
  if (loaded) await recomputeOrder(svc, loaded.order, loaded.items);

  return NextResponse.json({ ok: true, order_id: orderId, lines: rows.length });
}
