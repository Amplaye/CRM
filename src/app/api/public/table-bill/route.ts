import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures } from "@/lib/types/tenant-settings";
import { computeTotals, isActiveLine } from "@/lib/cassa/totals";
import { resolveTenantStripeKey } from "@/lib/billing/tenant-stripe";
import { assertRateLimit } from "@/lib/rate-limit";
import type { CassaOrderRow, CassaOrderItemRow } from "@/lib/cassa/types";

// PUBLIC read of a table's open bill — the "Conto" sheet behind the table QR
// (/m/<slug>?table=<id>). Anonymous guest, so the same trust rules as
// /api/public/order: tenant by slug, table must belong to it, and the response
// exposes ONLY what a printed pre-bill would (names, quantities, prices) — no
// ids of other tables, no session data, no guest info.
//
// GET ?slug=<tenant slug>&table_id=<restaurant_tables.id>
// → { payable, reason?, table, order? }  reason when not payable:
//   qr_pay_disabled | no_stripe | cassa_closed | no_order

export async function GET(req: NextRequest) {
  const rl = await assertRateLimit(req, "public:table-bill", { max: 30, windowSecs: 60 });
  if (rl) return rl;

  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") || "").trim();
  const tableId = (url.searchParams.get("table_id") || "").trim();
  if (!slug || !tableId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const svc = createServiceRoleClient();

  const { data: tenant } = await svc
    .from("tenants")
    .select("id, status, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!getFeatures(tenant.settings as any).qr_pay_enabled) {
    return NextResponse.json({ error: "qr_pay_disabled" }, { status: 403 });
  }

  const { data: table } = await svc
    .from("restaurant_tables")
    .select("id, name")
    .eq("id", tableId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!table) return NextResponse.json({ error: "table_not_found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currency = String((tenant.settings as any)?.currency || "EUR").toUpperCase();

  // The three gates a guest can hit, reported (not errored) so the sheet can
  // explain instead of failing: no venue Stripe key, till closed, no open bill.
  const stripeKey = await resolveTenantStripeKey(svc, tenant.id);

  const { data: session } = await svc
    .from("cassa_sessions")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("status", "open")
    .maybeSingle();

  const { data: orderRow } = await svc
    .from("cassa_orders")
    .select("*")
    .eq("tenant_id", tenant.id)
    .eq("table_id", table.id)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  const base = { table: { id: table.id, name: table.name || "" }, currency };
  if (!orderRow) return NextResponse.json({ ...base, payable: false, reason: "no_order" });

  const order = orderRow as CassaOrderRow;
  const { data: itemRows } = await svc
    .from("cassa_order_items")
    .select("*")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });
  const items = (itemRows || []) as CassaOrderItemRow[];

  const active = items.filter(isActiveLine);
  const totals = computeTotals(order, items);

  const reason = !stripeKey ? "no_stripe" : !session ? "cassa_closed" : totals.total <= 0 ? "no_order" : null;

  return NextResponse.json({
    ...base,
    payable: !reason,
    ...(reason ? { reason } : {}),
    order: {
      items: active.map((i) => ({
        name: i.name,
        qty: i.qty,
        unit_price: i.unit_price,
        variants: (i.variants || []).map((v) => v.name),
      })),
      covers: order.covers,
      cover_total: totals.coverTotal,
      discount: totals.discountAmount,
      subtotal: totals.subtotal,
      total: totals.total,
    },
  });
}
