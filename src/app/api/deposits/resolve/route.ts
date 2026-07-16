import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { capturePaymentIntent, cancelPaymentIntent, refundPaymentIntent } from "@/lib/billing/stripe";
import { logAuditEvent } from "@/lib/audit";
import { logSystemEvent } from "@/lib/system-log";

// Settle an authorized deposit hold:
//   forfeit → capture the PaymentIntent (guest no-showed, money is kept)
//   release → cancel the hold (guest showed up, card never charged)
//   refund  → refund a previously-forfeited capture (goodwill)
// Stripe first, DB second: if Stripe fails we change nothing and return the
// error; if the DB write fails after a Stripe success, reservation_payments
// still gets its row on retry because all three Stripe calls are idempotent
// (Stripe idempotency keys derived from the reservation).

const ACTIONS = {
  forfeit: { from: ["authorized"], to: "forfeited", movement: "captured" },
  release: { from: ["authorized"], to: "released", movement: "cancelled" },
  refund: { from: ["forfeited", "paid"], to: "refunded", movement: "refunded" },
} as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const reservationId = String(body.reservation_id || "");
    const action = String(body.action || "") as keyof typeof ACTIONS;
    if (!tenantId || !reservationId || !ACTIONS[action]) {
      return NextResponse.json({ error: "tenant_id, reservation_id and action (forfeit|release|refund) required" }, { status: 400 });
    }
    const member = await verifyTenantMembership(tenantId, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const svc = createServiceRoleClient();
    const { data: r } = await svc
      .from("reservations")
      .select("id, deposit_status, deposit_payment_intent_id, deposit_amount_cents, deposit_currency")
      .eq("id", reservationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const rule = ACTIONS[action];
    if (!(rule.from as readonly string[]).includes(r.deposit_status)) {
      return NextResponse.json({ error: "invalid_state", deposit_status: r.deposit_status }, { status: 409 });
    }
    if (!r.deposit_payment_intent_id) {
      return NextResponse.json({ error: "missing_payment_intent" }, { status: 409 });
    }

    const idem = `deposit_${action}_${reservationId}`;
    try {
      if (action === "forfeit") await capturePaymentIntent(r.deposit_payment_intent_id, idem);
      else if (action === "release") await cancelPaymentIntent(r.deposit_payment_intent_id, idem);
      else await refundPaymentIntent(r.deposit_payment_intent_id, idem);
    } catch (e) {
      // Surfaced to the UI: a hold older than ~7 days is auto-released by
      // Stripe and can no longer be captured.
      const msg = e instanceof Error ? e.message : "stripe_error";
      try {
        logSystemEvent({
          category: "api_error",
          severity: "medium",
          title: "Deposit settle failed",
          description: `${action} on reservation ${reservationId}: ${msg}`,
          error_key: `deposit:${reservationId}`,
        });
      } catch { /* logging must never mask the real error */ }
      return NextResponse.json({ error: "stripe_error", detail: msg }, { status: 502 });
    }

    await svc
      .from("reservations")
      .update({ deposit_status: rule.to })
      .eq("id", reservationId)
      .eq("tenant_id", tenantId);
    await svc.from("reservation_payments").insert({
      tenant_id: tenantId,
      reservation_id: reservationId,
      kind: "deposit",
      action: rule.movement,
      amount_cents: Number(r.deposit_amount_cents) || 0,
      currency: r.deposit_currency || "eur",
      stripe_payment_intent_id: r.deposit_payment_intent_id,
    });
    await logAuditEvent({
      tenant_id: tenantId,
      action: `deposit_${action}`,
      entity_id: reservationId,
      idempotency_key: idem,
      source: "staff",
      details: { by: member.userId, amount_cents: r.deposit_amount_cents },
    });

    return NextResponse.json({ success: true, deposit_status: rule.to });
  } catch (e) {
    console.error("[deposits/resolve]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
