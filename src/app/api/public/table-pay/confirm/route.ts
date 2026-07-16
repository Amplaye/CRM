import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures } from "@/lib/types/tenant-settings";
import { resolveTenantStripeKey, retrieveTenantCheckoutSession } from "@/lib/billing/tenant-stripe";
import { settleOrderPaidOnline } from "@/lib/cassa/settle";
import { loadOrder } from "@/lib/cassa/server";
import { fromCents } from "@/lib/cassa/totals";
import { assertRateLimit } from "@/lib/rate-limit";
import { logSystemEvent } from "@/lib/system-log";

// PUBLIC pay-at-table step 2: the guest's phone lands back on the menu with
// ?pay=success&cs=<session id> and POSTs it here. This is PULL verification —
// a BYO Stripe account has no webhook endpoint configured, so instead of
// trusting the redirect (anyone can type that URL) we ask Stripe directly,
// WITH THE TENANT'S KEY, whether that session is really paid.
//
// POST { slug, session_id } → { status: "settled", receipt_number, ... }
//                           | { status: "amount_mismatch" | "already_closed" }
//
// Race outcomes, all money-safe:
//   • verified paid + total unchanged  → settle (same atomic fiscal path as the
//     till, method 'online'); unique(stripe_session_id) + the open→paid claim
//     inside fn_cassa_pay_atomic make double-taps harmless;
//   • verified paid + total CHANGED    → 'amount_mismatch': never close a bill
//     different from the one that was paid — staff gets a critical alert and
//     settles by hand;
//   • verified paid + order no longer open (staff charged it at the till while
//     the guest was on Stripe) → 'failed' + critical alert: possible double
//     charge, refund from the venue's Stripe dashboard.

export async function POST(req: NextRequest) {
  const rl = await assertRateLimit(req, "public:table-pay-confirm", { max: 10, windowSecs: 60 });
  if (rl) return rl;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const sessionId = typeof body?.session_id === "string" ? body.session_id.trim() : "";
  if (!slug || !sessionId || sessionId.length > 200) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

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

  // The session must be one WE created for THIS tenant (checkout wrote the row).
  const { data: qr } = await svc
    .from("cassa_qr_payments")
    .select("*")
    .eq("tenant_id", tenant.id)
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (!qr) return NextResponse.json({ error: "session_not_found" }, { status: 404 });

  // Idempotent replay: refresh/double-tap after settling returns the receipt.
  if (qr.status === "settled") {
    return NextResponse.json({
      status: "settled",
      receipt_number: qr.receipt_number,
      receipt_year: qr.receipt_year,
      total: fromCents(qr.amount_cents),
    });
  }
  if (qr.status === "amount_mismatch") return NextResponse.json({ status: "amount_mismatch" });
  if (qr.status === "failed") return NextResponse.json({ status: "already_closed" });

  const stripeKey = await resolveTenantStripeKey(svc, tenant.id);
  if (!stripeKey) return NextResponse.json({ error: "no_stripe" }, { status: 409 });

  // Ask Stripe, not the URL bar.
  let paid = false;
  let amountTotal: number | null = null;
  try {
    const s = await retrieveTenantCheckoutSession(stripeKey, sessionId);
    paid = s.paid;
    amountTotal = s.amountTotal;
  } catch {
    return NextResponse.json({ error: "stripe_unreachable" }, { status: 502 });
  }
  if (!paid) return NextResponse.json({ status: "unpaid" });
  const paidCents = amountTotal ?? qr.amount_cents;

  const nowIso = new Date().toISOString();
  const mark = (status: string, extra: Record<string, unknown> = {}) =>
    svc.from("cassa_qr_payments").update({ status, updated_at: nowIso, ...extra }).eq("id", qr.id);

  const loaded = qr.order_id ? await loadOrder(svc, qr.order_id) : null;
  if (!loaded || loaded.order.tenant_id !== tenant.id || loaded.order.status !== "open") {
    // Money confirmed on a bill that is no longer open: staff must arbitrate.
    await mark("failed");
    await logSystemEvent({
      tenant_id: tenant.id,
      category: "api_error",
      severity: "critical",
      title: "Pagamento QR su conto già chiuso — possibile doppio incasso",
      description: `Il cliente del tavolo ${qr.table_name || qr.table_id} ha pagato ${fromCents(paidCents)} online (sessione ${sessionId}) ma l'ordine ${qr.order_id ?? "—"} non è più aperto. Verificare e, se già incassato in cassa, rimborsare dal pannello Stripe del locale.`,
    });
    return NextResponse.json({ status: "already_closed" });
  }

  const result = await settleOrderPaidOnline(svc, {
    tenantId: tenant.id,
    order: loaded.order,
    items: loaded.items,
    expectedTotalCents: paidCents,
  });

  if (result.ok) {
    await mark("settled", { receipt_number: result.receiptNumber, receipt_year: result.receiptYear });
    return NextResponse.json({
      status: "settled",
      receipt_number: result.receiptNumber,
      receipt_year: result.receiptYear,
      total: result.total,
      fiscal: result.fiscal,
    });
  }

  if (result.error === "amount_mismatch") {
    await mark("amount_mismatch");
    await logSystemEvent({
      tenant_id: tenant.id,
      category: "api_error",
      severity: "critical",
      title: "Pagamento QR: importo diverso dal conto — incasso da sistemare",
      description: `Il cliente del tavolo ${qr.table_name || qr.table_id} ha pagato ${fromCents(result.expectedCents)} online ma il conto ora è ${fromCents(result.currentCents)} (ordine ${qr.order_id}). Il conto NON è stato chiuso: registrare l'incasso online in cassa e sistemare la differenza.`,
    });
    return NextResponse.json({ status: "amount_mismatch" });
  }

  if (result.error === "order_not_open") {
    // Lost the claim race to the till between our check and the RPC.
    await mark("failed");
    await logSystemEvent({
      tenant_id: tenant.id,
      category: "api_error",
      severity: "critical",
      title: "Pagamento QR su conto già chiuso — possibile doppio incasso",
      description: `Sessione ${sessionId}, tavolo ${qr.table_name || qr.table_id}, ordine ${qr.order_id}: pagato online ma il conto è stato chiuso nel frattempo. Verificare e rimborsare se doppio.`,
    });
    return NextResponse.json({ status: "already_closed" });
  }

  // fiscal_denied / cassa_closed / empty_order / pay_failed: money is captured but
  // the order could not be closed — surface to staff, tell the guest it's handled.
  await logSystemEvent({
    tenant_id: tenant.id,
    category: "api_error",
    severity: "critical",
    title: "Pagamento QR ricevuto ma conto non chiuso",
    description: `Sessione ${sessionId}, tavolo ${qr.table_name || qr.table_id}, ordine ${qr.order_id}: pagamento verificato su Stripe ma la chiusura è fallita (${result.error}). Chiudere il conto a mano con metodo "online".`,
  });
  return NextResponse.json({ status: "needs_staff" });
}
