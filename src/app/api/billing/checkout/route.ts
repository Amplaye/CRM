import { NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import {
  PLANS,
  ADDONS,
  resolveStripePriceId,
  resolvePaypalPlanId,
  type PlanId,
  type AddonId,
  type BillingCycle,
} from "@/lib/billing/catalog";
import { stripeConfigured, createCheckoutSession } from "@/lib/billing/stripe";
import { paypalConfigured, createSubscription } from "@/lib/billing/paypal";

// Settings → Payments → "Pay with Stripe / PayPal". Builds a hosted checkout for
// either a main plan (premium/business, monthly/yearly) or an add-on, on the
// chosen provider, and returns the redirect url the UI sends the owner to.
//
// User-authenticated + tenant-membership checked (authorizeTenant). The actual
// subscription state is written later by the webhook, never trusted from the
// browser. When the provider keys/price ids aren't configured yet, returns a clean
// 503 with `reason: "not_configured"` so the UI can show "coming soon" instead of
// a crash.
//
// Body: { tenant_id, provider: "stripe"|"paypal", kind: "plan"|"addon",
//         plan?, cycle?, addon?, email? }

type Provider = "stripe" | "paypal";

export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string | undefined = body?.tenant_id;
  const provider: Provider | undefined = body?.provider;
  const kind: "plan" | "addon" | undefined = body?.kind;
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  if (provider !== "stripe" && provider !== "paypal") {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }
  if (kind !== "plan" && kind !== "addon") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  // Resolve what's being bought.
  let planId: PlanId | undefined;
  let cycle: BillingCycle | undefined;
  let addonId: AddonId | undefined;
  let isOneOff = false;

  if (kind === "plan") {
    planId = body?.plan;
    cycle = body?.cycle === "yearly" ? "yearly" : "monthly";
    if (!PLANS.some((p) => p.id === planId)) {
      return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
    }
  } else {
    addonId = body?.addon;
    const addon = ADDONS.find((a) => a.id === addonId);
    if (!addon) return NextResponse.json({ error: "invalid_addon" }, { status: 400 });
    if (addon.comingSoon) return NextResponse.json({ error: "addon_coming_soon" }, { status: 400 });
    isOneOff = addon.billing === "oneoff";
  }

  const email: string | undefined = typeof body?.email === "string" ? body.email : undefined;
  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://crm.baliflowagency.com";
  const successUrl = `${origin}/settings?tab=payments&checkout=success`;
  const cancelUrl = `${origin}/settings?tab=payments&checkout=cancel`;

  // ---------------- STRIPE ----------------
  if (provider === "stripe") {
    if (!stripeConfigured()) {
      return NextResponse.json({ error: "not_configured", reason: "stripe_keys_missing" }, { status: 503 });
    }
    const priceId =
      kind === "plan" ? resolveStripePriceId(planId!, cycle!) : resolveStripePriceId(addonId!);
    if (!priceId) {
      return NextResponse.json({ error: "not_configured", reason: "stripe_price_missing" }, { status: 503 });
    }
    try {
      const session = await createCheckoutSession({
        mode: isOneOff ? "payment" : "subscription",
        lineItems: [{ price: priceId, quantity: 1 }],
        successUrl,
        cancelUrl,
        customerEmail: email,
        clientReferenceId: tenantId,
        metadata: { tenant_id: tenantId, kind, plan: planId || "", cycle: cycle || "", addon: addonId || "" },
      });
      return NextResponse.json({ ok: true, url: session.url });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return NextResponse.json({ error: "stripe_error", detail: e?.message }, { status: 502 });
    }
  }

  // ---------------- PAYPAL ----------------
  // PayPal subscriptions need a pre-made billing plan; one-offs aren't wired here
  // (the only one-off is website design — sell it via Stripe or invoice).
  if (isOneOff) {
    return NextResponse.json({ error: "paypal_no_oneoff", reason: "use_stripe_for_oneoff" }, { status: 400 });
  }
  if (!paypalConfigured()) {
    return NextResponse.json({ error: "not_configured", reason: "paypal_keys_missing" }, { status: 503 });
  }
  const planRef = kind === "plan" ? resolvePaypalPlanId(planId!, cycle!) : resolvePaypalPlanId(addonId!);
  if (!planRef) {
    return NextResponse.json({ error: "not_configured", reason: "paypal_plan_missing" }, { status: 503 });
  }
  try {
    const sub = await createSubscription({
      planId: planRef,
      customId: tenantId,
      returnUrl: successUrl,
      cancelUrl,
      subscriberEmail: email,
    });
    return NextResponse.json({ ok: true, url: sub.approveUrl, subscription_id: sub.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return NextResponse.json({ error: "paypal_error", detail: e?.message }, { status: 502 });
  }
}
