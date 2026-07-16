import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures } from "@/lib/types/tenant-settings";
import { getFiscalContext, assertFiscal } from "@/lib/fiscal/server";
import { computeTotals, toCents, isActiveLine } from "@/lib/cassa/totals";
import { resolveTenantStripeKey, createTableBillCheckoutSession } from "@/lib/billing/tenant-stripe";
import { assertRateLimit } from "@/lib/rate-limit";
import { logSystemEvent } from "@/lib/system-log";
import type { CassaOrderRow, CassaOrderItemRow } from "@/lib/cassa/types";

// PUBLIC pay-at-table step 1: turn the table's open bill into a Stripe Checkout
// on the TENANT'S OWN Stripe account (BYO key — no key, no checkout; the
// platform key is never a fallback for a venue's takings).
//
// POST { slug, table_id } → { url }
//
// The amount is the SERVER total at this instant, frozen into the session and
// into a cassa_qr_payments row. Nothing is claimed yet: the order stays open,
// staff can keep working it. The confirm step (on return from Stripe) is the
// only writer that can close it — and it re-compares the paid amount with the
// then-current total first.
//
// The fiscal guard runs HERE, before the guest types a card number: a till that
// may not issue tickets must refuse the money while it can still refuse it.

export async function POST(req: NextRequest) {
  const rl = await assertRateLimit(req, "public:table-pay", { max: 5, windowSecs: 60 });
  if (rl) return rl;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const tableId = typeof body?.table_id === "string" ? body.table_id.trim() : "";
  if (!slug || !tableId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const svc = createServiceRoleClient();

  const { data: tenant } = await svc
    .from("tenants")
    .select("id, name, slug, status, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = tenant.settings as any;
  if (!getFeatures(settings).qr_pay_enabled) {
    return NextResponse.json({ error: "qr_pay_disabled" }, { status: 403 });
  }

  const fiscal = await getFiscalContext(svc, tenant.id);
  const denied = assertFiscal(fiscal);
  if (denied) return denied;

  const { data: table } = await svc
    .from("restaurant_tables")
    .select("id, name")
    .eq("id", tableId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!table) return NextResponse.json({ error: "table_not_found" }, { status: 404 });

  const stripeKey = await resolveTenantStripeKey(svc, tenant.id);
  if (!stripeKey) return NextResponse.json({ error: "no_stripe" }, { status: 409 });

  const { data: session } = await svc
    .from("cassa_sessions")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("status", "open")
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "cassa_closed" }, { status: 409 });

  const { data: orderRow } = await svc
    .from("cassa_orders")
    .select("*")
    .eq("tenant_id", tenant.id)
    .eq("table_id", table.id)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (!orderRow) return NextResponse.json({ error: "no_order" }, { status: 409 });
  const order = orderRow as CassaOrderRow;

  const { data: itemRows } = await svc
    .from("cassa_order_items")
    .select("*")
    .eq("order_id", order.id);
  const items = (itemRows || []) as CassaOrderItemRow[];
  const totals = computeTotals(order, items);
  if (items.filter(isActiveLine).length === 0 || totals.total <= 0) {
    return NextResponse.json({ error: "no_order" }, { status: 409 });
  }

  const amountCents = toCents(totals.total);
  const currency = String(settings?.currency || "EUR");
  const locale = ["it", "es", "en", "de"].includes(settings?.crm_locale) ? settings.crm_locale : undefined;
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://crm.baliflowagency.com";
  const back = `${origin}/m/${tenant.slug}?table=${table.id}`;
  const productName = `${tenant.name} — ${table.name || "Table"}`;

  try {
    const checkout = await createTableBillCheckoutSession(stripeKey, {
      amountCents,
      currency,
      productName,
      // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect — it's what
      // lets the guest's phone tell confirm WHICH session to verify.
      successUrl: `${back}&pay=success&cs={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${back}&pay=cancel`,
      metadata: {
        kind: "table_pay",
        tenant_id: tenant.id,
        order_id: order.id,
        table_id: table.id,
      },
      locale,
    });

    const { error: insErr } = await svc.from("cassa_qr_payments").insert({
      tenant_id: tenant.id,
      order_id: order.id,
      table_id: table.id,
      table_name: table.name || "",
      stripe_session_id: checkout.id,
      amount_cents: amountCents,
      currency: currency.toLowerCase(),
      status: "pending",
    });
    if (insErr) {
      // Without this row the confirm step can't verify the session → don't hand
      // the guest a link we won't be able to reconcile.
      await logSystemEvent({
        tenant_id: tenant.id,
        category: "api_error",
        severity: "high",
        title: "Pagamento QR: sessione non registrata",
        description: `Checkout ${checkout.id} creato ma insert cassa_qr_payments fallita: ${insErr.message}`,
      });
      return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
    }

    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    await logSystemEvent({
      tenant_id: tenant.id,
      category: "api_error",
      severity: "high",
      title: "Pagamento QR: checkout Stripe fallito",
      description: `Tavolo ${table.name || table.id}, ordine ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
    });
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
