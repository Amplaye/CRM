import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyWebhook } from "@/lib/billing/paypal";
import { upsertSubscription } from "@/lib/billing/state";

// PayPal webhook — trusted writer of PayPal-side subscription state. PayPal has no
// local HMAC; verification is a server call (verify-webhook-signature) needing
// PAYPAL_WEBHOOK_ID. We handle the subscription lifecycle events and map them onto
// upsertSubscription. tenant_id rides along as `custom_id` set at create time.
//
// Configure in PayPal: webhook → /api/billing/webhook/paypal, events:
//   BILLING.SUBSCRIPTION.ACTIVATED, .UPDATED, .CANCELLED, .SUSPENDED, .EXPIRED,
//   PAYMENT.SALE.COMPLETED (renewal).

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const headers: Record<string, string | null> = {
    "paypal-auth-algo": req.headers.get("paypal-auth-algo"),
    "paypal-cert-url": req.headers.get("paypal-cert-url"),
    "paypal-transmission-id": req.headers.get("paypal-transmission-id"),
    "paypal-transmission-sig": req.headers.get("paypal-transmission-sig"),
    "paypal-transmission-time": req.headers.get("paypal-transmission-time"),
  };

  let ok = false;
  try {
    ok = await verifyWebhook(headers, raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return NextResponse.json({ error: "verify_failed", detail: e?.message }, { status: 400 });
  }
  if (!ok) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const resource = event.resource || {};
  const subId: string | undefined = resource.id || resource.billing_agreement_id;
  const tenantId: string | undefined =
    resource.custom_id || (await tenantFromPaypalSub(svc, subId));

  try {
    switch (event.event_type) {
      case "BILLING.SUBSCRIPTION.ACTIVATED":
        if (tenantId) {
          await upsertSubscription(svc, tenantId, {
            status: "active",
            provider: "paypal",
            paypal_subscription_id: subId || null,
            current_period_end: resource.billing_info?.next_billing_time || undefined,
          });
        }
        break;
      case "BILLING.SUBSCRIPTION.UPDATED":
      case "PAYMENT.SALE.COMPLETED":
        if (tenantId) {
          await upsertSubscription(svc, tenantId, {
            status: "active",
            provider: "paypal",
            paypal_subscription_id: subId || undefined,
            current_period_end: resource.billing_info?.next_billing_time || undefined,
          });
        }
        break;
      case "BILLING.SUBSCRIPTION.SUSPENDED":
        if (tenantId) await upsertSubscription(svc, tenantId, { status: "past_due" });
        break;
      case "BILLING.SUBSCRIPTION.CANCELLED":
      case "BILLING.SUBSCRIPTION.EXPIRED":
        if (tenantId) await upsertSubscription(svc, tenantId, { status: "canceled" });
        break;
      default:
        break;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return NextResponse.json({ error: "handler_error", detail: e?.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function tenantFromPaypalSub(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  subId?: string,
): Promise<string | undefined> {
  if (!subId) return undefined;
  const { data } = await svc
    .from("subscriptions")
    .select("tenant_id")
    .eq("paypal_subscription_id", subId)
    .maybeSingle();
  return data?.tenant_id || undefined;
}
