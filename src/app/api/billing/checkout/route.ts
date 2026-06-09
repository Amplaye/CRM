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
// Body: { tenant_id, provider: "stripe"|"paypal", kind: "plan"|"addon"|"bundle",
//         plan?, cycle?, addon?, addons?, email? }
//
// "bundle" pays for a plan AND one or more recurring add-ons in a SINGLE Stripe
// subscription checkout (one invoice, one renewal). It's Stripe-only: PayPal
// subscriptions can carry just one billing plan, so a combined cart can't map to a
// single PayPal subscription. One-off add-ons (website design) can't ride a
// subscription session either, so they're dropped from the bundle and bought
// separately.

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
  const kind: "plan" | "addon" | "bundle" | undefined = body?.kind;
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  if (provider !== "stripe" && provider !== "paypal") {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }
  if (kind !== "plan" && kind !== "addon" && kind !== "bundle") {
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
  let bundleAddonIds: AddonId[] = [];
  let isOneOff = false;

  if (kind === "plan") {
    planId = body?.plan;
    cycle = body?.cycle === "yearly" ? "yearly" : "monthly";
    if (!PLANS.some((p) => p.id === planId)) {
      return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
    }
  } else if (kind === "addon") {
    addonId = body?.addon;
    const addon = ADDONS.find((a) => a.id === addonId);
    if (!addon) return NextResponse.json({ error: "invalid_addon" }, { status: 400 });
    if (addon.comingSoon) return NextResponse.json({ error: "addon_coming_soon" }, { status: 400 });
    isOneOff = addon.billing === "oneoff";
  } else {
    // bundle: a plan + N recurring add-ons in one subscription. Stripe-only.
    if (provider !== "stripe") {
      return NextResponse.json({ error: "bundle_stripe_only" }, { status: 400 });
    }
    planId = body?.plan;
    cycle = body?.cycle === "yearly" ? "yearly" : "monthly";
    if (!PLANS.some((p) => p.id === planId)) {
      return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
    }
    const raw: unknown[] = Array.isArray(body?.addons) ? body.addons : [];
    // Keep only real, recurring, non-coming-soon add-ons; dedupe; preserve catalog order.
    const wanted = new Set(raw.filter((x): x is string => typeof x === "string"));
    bundleAddonIds = ADDONS.filter(
      (a) => wanted.has(a.id) && a.billing === "recurring" && !a.comingSoon,
    ).map((a) => a.id);
    if (bundleAddonIds.length === 0) {
      // No payable add-ons selected — fall back to a plain plan checkout.
      return NextResponse.json({ error: "bundle_no_addons" }, { status: 400 });
    }
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

    // Build the line items + resolve every price up front; bail cleanly if any
    // price id is missing so the owner never lands on a half-broken checkout.
    const lineItems: { price: string; quantity: number }[] = [];
    if (kind === "plan") {
      const priceId = resolveStripePriceId(planId!, cycle!);
      if (!priceId) return NextResponse.json({ error: "not_configured", reason: "stripe_price_missing" }, { status: 503 });
      lineItems.push({ price: priceId, quantity: 1 });
    } else if (kind === "addon") {
      const priceId = resolveStripePriceId(addonId!);
      if (!priceId) return NextResponse.json({ error: "not_configured", reason: "stripe_price_missing" }, { status: 503 });
      lineItems.push({ price: priceId, quantity: 1 });
    } else {
      // bundle: plan price + one recurring price per selected add-on.
      const planPrice = resolveStripePriceId(planId!, cycle!);
      if (!planPrice) return NextResponse.json({ error: "not_configured", reason: "stripe_price_missing" }, { status: 503 });
      lineItems.push({ price: planPrice, quantity: 1 });
      for (const aId of bundleAddonIds) {
        // Resolve at the bundle's cycle: a yearly bundle needs the add-on's
        // yearly price too — Stripe Checkout can't mix billing intervals in one
        // subscription. resolveStripePriceId falls back to the monthly price if
        // no yearly one exists; for a yearly bundle that would re-introduce the
        // mismatch, so reject cleanly instead of letting Stripe 502.
        const addonPrice = resolveStripePriceId(aId, cycle!);
        const addonYearly = process.env[`STRIPE_PRICE_ADDON_${aId.toUpperCase()}_YEARLY`];
        if (!addonPrice || (cycle === "yearly" && !addonYearly)) {
          return NextResponse.json({ error: "not_configured", reason: "stripe_addon_yearly_missing" }, { status: 503 });
        }
        lineItems.push({ price: addonPrice, quantity: 1 });
      }
    }

    try {
      const session = await createCheckoutSession({
        mode: isOneOff ? "payment" : "subscription",
        lineItems,
        successUrl,
        cancelUrl,
        customerEmail: email,
        clientReferenceId: tenantId,
        metadata: {
          tenant_id: tenantId,
          kind,
          plan: planId || "",
          cycle: cycle || "",
          addon: addonId || "",
          // CSV of bundled add-on ids — the webhook activates each one.
          addons: bundleAddonIds.join(","),
        },
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
