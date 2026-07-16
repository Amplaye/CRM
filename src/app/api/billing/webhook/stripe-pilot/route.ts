import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyWebhook } from "@/lib/billing/stripe";
import { activatePilotFromSession, patchPilotByStripe, mapStripeSubStatus } from "@/lib/billing/pilot";
import { apiError } from "@/lib/api-error";

// Dedicated Stripe webhook for the paid-pilot → subscription flow. Kept SEPARATE
// from /api/billing/webhook/stripe so the pilot can't disturb the existing
// self-serve billing webhook. It has its OWN signing secret.
//
// Configure in Stripe: a second endpoint = /api/billing/webhook/stripe-pilot, with
// signing secret in STRIPE_PILOT_WEBHOOK_SECRET (falls back to STRIPE_WEBHOOK_SECRET
// only if you point a single endpoint at both — but per-endpoint secrets differ, so
// a dedicated secret is correct). Events:
//   checkout.session.completed, customer.subscription.created,
//   customer.subscription.updated, customer.subscription.deleted,
//   invoice.payment_succeeded, invoice.payment_failed
//
// Must read the RAW body for signature verification — req.text(), not req.json().
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_PILOT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = verifyWebhook(raw, sig, secret);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return apiError(e, { route: "billing/webhook/stripe-pilot", publicMessage: "invalid_signature", status: 400 });
  }

  const svc = createServiceRoleClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        // Only act on pilot sessions; activation is idempotent on retries.
        if (s.metadata?.flow !== "paid_pilot_to_subscription") break;
        await activatePilotFromSession(svc, s);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        await patchPilotByStripe(
          svc,
          { subscriptionId: sub.id, customerId: sub.customer },
          {
            subscription_status: mapStripeSubStatus(String(sub.status)),
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : undefined,
            cancel_at_period_end: !!sub.cancel_at_period_end,
            pilot_start: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : undefined,
            pilot_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : undefined,
          },
        );
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await patchPilotByStripe(
          svc,
          { subscriptionId: sub.id, customerId: sub.customer },
          { subscription_status: "canceled", canceled: true, canceled_at: new Date().toISOString() },
        );
        break;
      }

      case "invoice.payment_succeeded": {
        const inv = event.data.object;
        await patchPilotByStripe(
          svc,
          { subscriptionId: inv.subscription, customerId: inv.customer },
          { payment_status: "paid" },
        );
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object;
        await patchPilotByStripe(
          svc,
          { subscriptionId: inv.subscription, customerId: inv.customer },
          { payment_status: "failed", subscription_status: "past_due" },
        );
        break;
      }

      default:
        break;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // 500 → Stripe retries with backoff; handlers are idempotent.
    return apiError(e, { route: "billing/webhook/stripe-pilot", publicMessage: "handler_error" });
  }

  return NextResponse.json({ received: true });
}
