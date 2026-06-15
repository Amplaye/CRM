// Paid pilot → subscription flow for BALI Flow.
//
// The customer pays €150 today for a 14-day pilot. Unless cancelled before day 14,
// a monthly subscription auto-starts on the saved card, and the €150 is credited
// against the FIRST monthly invoice. Two plans:
//
//   plan      pilot today   first invoice (day 14)   then monthly
//   founder   €150          €149  (€299 − €150)       €299
//   premium   €150          €249  (€399 − €150)       €399
//
// Mechanics (see explanation in stripe.ts):
//   1. createPilotCheckout() → Checkout mode=payment: charges €150, saves card,
//      creates customer, collects billing details, shows the consent text.
//   2. activatePilotFromSession() (called by the webhook on checkout.session.completed):
//      creates a 14-day trialing subscription at the FULL monthly price, then applies
//      a −€150 reduction to the first real invoice (customer-balance credit by default,
//      or STRIPE_PILOT_CREDIT_COUPON_ID if set).
//
// The €150 reduction equals the pilot fee for BOTH plans, so NO separate €149/€249
// "first month" prices are needed.

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  stripeConfigured,
  createPilotCheckoutSession,
  retrievePaymentIntent,
  retrieveCheckoutSession,
  updateCustomer,
  createPilotSubscription,
  addCustomerCredit,
  cancelSubscription,
} from "./stripe";

export type PilotPlan = "founder" | "premium";

export const PILOT_TRIAL_DAYS = 14;
export const PILOT_FEE_CENTS = 15000;          // €150
export const PILOT_FIRST_MONTH_CREDIT_CENTS = 15000; // €150
export const PILOT_CURRENCY = "eur";

/** Per-plan config. Monthly prices come from env (never hard-coded ids). Amounts
 * are kept here only for display/audit; the truth is the Stripe price. */
export const PILOT_PLANS: Record<
  PilotPlan,
  { label: string; monthlyPriceEnv: string; monthlyCents: number; firstInvoiceCents: number }
> = {
  founder: {
    label: "Founder",
    monthlyPriceEnv: "STRIPE_FOUNDER_MONTHLY_PRICE_ID",
    monthlyCents: 29900,
    firstInvoiceCents: 29900 - PILOT_FIRST_MONTH_CREDIT_CENTS, // 14900
  },
  premium: {
    label: "Premium",
    monthlyPriceEnv: "STRIPE_PREMIUM_MONTHLY_PRICE_ID",
    monthlyCents: 39900,
    firstInvoiceCents: 39900 - PILOT_FIRST_MONTH_CREDIT_CENTS, // 24900
  },
};

export const PILOT_CONSENT_TEXT =
  "You are purchasing a 14-day BALI Flow Pilot for €150. Unless cancelled before " +
  "the pilot ends, your selected subscription will start automatically. The €150 " +
  "pilot fee will be credited against your first monthly payment.";

/** Shared metadata stamped on every Stripe object for this flow (req 9). */
export function pilotMetadata(plan: PilotPlan, extra?: Record<string, string>): Record<string, string> {
  return {
    product: "BALI Flow",
    flow: "paid_pilot_to_subscription",
    plan,
    pilot_fee: "150",
    first_month_credit: "150",
    ...extra,
  };
}

function taxEnabled(): boolean {
  return process.env.STRIPE_TAX_ENABLED === "true";
}

export type PilotCheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; status: number; error: string; reason?: string };

/** Build the Checkout Session for a pilot plan and record a pending row. Public
 * sales endpoint — no tenant auth (the buyer has no account yet). */
export async function createPilotCheckout(plan: PilotPlan, origin: string): Promise<PilotCheckoutResult> {
  if (!stripeConfigured()) {
    return { ok: false, status: 503, error: "not_configured", reason: "stripe_keys_missing" };
  }
  const cfg = PILOT_PLANS[plan];
  const pilotPriceId = process.env.STRIPE_PILOT_PRICE_ID;
  const monthlyPriceId = process.env[cfg.monthlyPriceEnv];
  if (!pilotPriceId || !monthlyPriceId) {
    return { ok: false, status: 503, error: "not_configured", reason: "stripe_price_missing" };
  }

  const successUrl =
    process.env.FRONTEND_SUCCESS_URL || `${origin}/pilot/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = process.env.FRONTEND_CANCEL_URL || `${origin}/pilot/cancel`;

  const metadata = pilotMetadata(plan);

  let session: { id: string; url: string };
  try {
    session = await createPilotCheckoutSession({
      pilotPriceId,
      successUrl,
      cancelUrl,
      consentMessage: PILOT_CONSENT_TEXT,
      metadata,
      taxEnabled: taxEnabled(),
      requireTos: process.env.STRIPE_REQUIRE_TOS === "true",
      businessNameLabel: "Business name (optional)",
    });
  } catch (e) {
    return { ok: false, status: 502, error: "stripe_error", reason: (e as Error)?.message };
  }

  // Record a pending row so an abandoned checkout is still visible, and so the
  // webhook upsert has a stable key (the session id).
  try {
    const svc = createServiceRoleClient();
    await svc.from("pilot_subscriptions").upsert(
      {
        plan,
        stripe_checkout_session_id: session.id,
        pilot_fee_cents: PILOT_FEE_CENTS,
        first_month_credit_cents: PILOT_FIRST_MONTH_CREDIT_CENTS,
        subscription_status: "incomplete",
        payment_status: "pending",
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_checkout_session_id" },
    );
  } catch (e) {
    // Non-fatal: the webhook re-upserts by session id. Log and continue.
    console.error("[pilot] failed to record pending row", { sessionId: session.id, error: e });
  }

  return { ok: true, url: session.url, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Webhook side
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any;

/** Idempotently activate the pilot subscription from a completed Checkout Session.
 * Safe to call multiple times (Stripe re-delivers webhooks): if the row already
 * has a subscription id, it's a no-op. */
export async function activatePilotFromSession(svc: Svc, sessionObj: Record<string, any>): Promise<void> {
  const sessionId = String(sessionObj.id);
  const plan = (sessionObj.metadata?.plan as PilotPlan) || undefined;
  if (plan !== "founder" && plan !== "premium") return; // not a pilot session

  // Has this session already been activated? (webhook retry) → skip sub creation.
  const { data: existing } = await svc
    .from("pilot_subscriptions")
    .select("id, stripe_subscription_id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (existing?.stripe_subscription_id) return;

  const customerId: string | undefined =
    typeof sessionObj.customer === "string" ? sessionObj.customer : sessionObj.customer?.id;
  if (!customerId) throw new Error("checkout session has no customer");

  // Resolve the saved payment method from the one-time PaymentIntent.
  let paymentMethod: string | undefined;
  const piRef = sessionObj.payment_intent;
  if (piRef) {
    const pi = await retrievePaymentIntent(typeof piRef === "string" ? piRef : String(piRef.id));
    paymentMethod = typeof pi.payment_method === "string" ? pi.payment_method : undefined;
  }

  const cfg = PILOT_PLANS[plan];
  const monthlyPriceId = process.env[cfg.monthlyPriceEnv];
  if (!monthlyPriceId) throw new Error(`${cfg.monthlyPriceEnv} not set`);
  const metadata = pilotMetadata(plan, { stripe_checkout_session_id: sessionId });

  // Make the saved card the customer default + stamp metadata.
  await updateCustomer(customerId, { defaultPaymentMethod: paymentMethod, metadata });

  // Create the 14-day trialing subscription at the FULL monthly price.
  const couponId = process.env.STRIPE_PILOT_CREDIT_COUPON_ID || undefined;
  const sub = await createPilotSubscription({
    customerId,
    monthlyPriceId,
    trialPeriodDays: PILOT_TRIAL_DAYS,
    defaultPaymentMethod: paymentMethod,
    couponId,
    taxEnabled: taxEnabled(),
    metadata,
    idempotencyKey: `pilot_sub_${sessionId}`,
  });

  // Apply the €150 reduction to the FIRST real invoice. Coupon (if configured) is
  // already attached above; otherwise use a customer-balance credit.
  if (!couponId) {
    await addCustomerCredit(
      customerId,
      -PILOT_FIRST_MONTH_CREDIT_CENTS,
      PILOT_CURRENCY,
      "BALI Flow pilot fee credited to first month",
      metadata,
      `pilot_credit_${sessionId}`,
    );
  }

  // Read collected billing details from the session.
  const details = sessionObj.customer_details || {};
  const businessName = (sessionObj.custom_fields || []).find(
    (f: any) => f.key === "business_name",
  )?.text?.value;
  const taxId = Array.isArray(details.tax_ids) && details.tax_ids[0]?.value ? details.tax_ids[0].value : null;

  const trialStart = sub.trial_start ? new Date(Number(sub.trial_start) * 1000).toISOString() : null;
  const trialEnd = sub.trial_end ? new Date(Number(sub.trial_end) * 1000).toISOString() : null;

  await svc.from("pilot_subscriptions").upsert(
    {
      plan,
      stripe_checkout_session_id: sessionId,
      stripe_customer_id: customerId,
      stripe_subscription_id: String(sub.id),
      customer_email: details.email || sessionObj.customer_email || null,
      customer_name: details.name || null,
      business_name: businessName || null,
      tax_id: taxId,
      pilot_fee_cents: PILOT_FEE_CENTS,
      first_month_credit_cents: PILOT_FIRST_MONTH_CREDIT_CENTS,
      pilot_start: trialStart,
      pilot_end: trialEnd,
      subscription_status: mapStripeSubStatus(String(sub.status)),
      payment_status: "paid", // the €150 pilot fee is captured at checkout
      metadata,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_checkout_session_id" },
  );
}

/** Find a pilot row by Stripe subscription or customer id. */
export async function findPilotByStripe(
  svc: Svc,
  subscriptionId?: string,
  customerId?: string,
): Promise<{ id: string; stripe_subscription_id: string | null; stripe_customer_id: string | null } | null> {
  if (subscriptionId) {
    const { data } = await svc
      .from("pilot_subscriptions")
      .select("id, stripe_subscription_id, stripe_customer_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (data) return data;
  }
  if (customerId) {
    const { data } = await svc
      .from("pilot_subscriptions")
      .select("id, stripe_subscription_id, stripe_customer_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Patch a pilot row found by Stripe ids. No-op if no matching pilot row (the
 * event belongs to the other, non-pilot billing flow). */
export async function patchPilotByStripe(
  svc: Svc,
  ids: { subscriptionId?: string; customerId?: string },
  patch: Record<string, unknown>,
): Promise<void> {
  const row = await findPilotByStripe(svc, ids.subscriptionId, ids.customerId);
  if (!row) return;
  await svc
    .from("pilot_subscriptions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", row.id);
}

export function mapStripeSubStatus(s: string): "incomplete" | "trialing" | "active" | "past_due" | "canceled" {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      return "incomplete";
  }
}

// ---------------------------------------------------------------------------
// Cancellation (admin / internal)
// ---------------------------------------------------------------------------

export type PilotCancelResult =
  | { ok: true; subscriptionId: string }
  | { ok: false; error: string };

/** Cancel a pilot subscription IMMEDIATELY so the first subscription invoice is
 * never charged. Callable internally (admin route, script). Looks the pilot up by
 * subscription id, customer id, OR session id, cancels in Stripe, and records it.
 * The €150 pilot fee is non-refundable and is NOT touched here. */
export async function cancelPilotSubscription(opts: {
  subscriptionId?: string;
  customerId?: string;
  sessionId?: string;
}): Promise<PilotCancelResult> {
  if (!stripeConfigured()) return { ok: false, error: "stripe_not_configured" };
  const svc = createServiceRoleClient();

  let query = svc.from("pilot_subscriptions").select("id, stripe_subscription_id");
  if (opts.subscriptionId) query = query.eq("stripe_subscription_id", opts.subscriptionId);
  else if (opts.customerId) query = query.eq("stripe_customer_id", opts.customerId);
  else if (opts.sessionId) query = query.eq("stripe_checkout_session_id", opts.sessionId);
  else return { ok: false, error: "no_identifier" };

  const { data: row } = await query.maybeSingle();
  if (!row?.stripe_subscription_id) return { ok: false, error: "pilot_not_found" };

  try {
    await cancelSubscription(row.stripe_subscription_id);
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "stripe_cancel_failed" };
  }

  await svc
    .from("pilot_subscriptions")
    .update({
      canceled: true,
      canceled_at: new Date().toISOString(),
      subscription_status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return { ok: true, subscriptionId: row.stripe_subscription_id };
}

export { retrieveCheckoutSession };
