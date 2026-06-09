import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyWebhook } from "@/lib/billing/stripe";
import { upsertSubscription } from "@/lib/billing/state";
import { syncVoiceProviderFromBilling } from "@/lib/billing/voice-billing";
import { PLANS, ADDONS } from "@/lib/billing/catalog";

// Stripe webhook — the ONLY trusted writer of subscription state. The browser
// never tells us "I paid"; Stripe does, signed. We verify the signature against
// STRIPE_WEBHOOK_SECRET (raw body, no SDK), then translate the handful of events
// we care about into upsertSubscription (which also mirrors settings.billing).
//
// Configure in Stripe: endpoint = /api/billing/webhook/stripe, events:
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted.
//
// Must read the RAW body for signature verification — req.text(), not req.json().

export const dynamic = "force-dynamic";

// Typed as Set<string> on purpose: these are membership checks against raw
// strings coming from Stripe metadata, so we don't want the literal-union
// element type to narrow the `.has()` argument.
const PLAN_IDS = new Set<string>(PLANS.map((p) => p.id));
const ADDON_IDS = new Set<string>(ADDONS.map((a) => a.id));

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = verifyWebhook(raw, sig);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // 400 → Stripe retries; a misconfigured secret shows up loudly here.
    return NextResponse.json({ error: "invalid_signature", detail: e?.message }, { status: 400 });
  }

  const svc = createServiceRoleClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const tenantId: string | undefined = s.client_reference_id || s.metadata?.tenant_id;
        if (!tenantId) break;
        const meta = s.metadata || {};
        const kind = meta.kind;
        const isAddon = kind === "addon" && ADDON_IDS.has(meta.addon);
        const isPlan = kind === "plan" && PLAN_IDS.has(meta.plan);
        const isBundle = kind === "bundle" && PLAN_IDS.has(meta.plan);

        if (isBundle) {
          // Plan + add-ons paid in one subscription. Activate the plan and merge
          // every bundled add-on (CSV in metadata) into the existing add-on list.
          const bundleAddons = String(meta.addons || "")
            .split(",")
            .map((x: string) => x.trim())
            .filter((x: string) => ADDON_IDS.has(x));
          const { data: existing } = await svc
            .from("subscriptions")
            .select("addons")
            .eq("tenant_id", tenantId)
            .maybeSingle();
          const addons = new Set<string>(existing?.addons || []);
          bundleAddons.forEach((a: string) => addons.add(a));
          const finalAddons = Array.from(addons);
          await upsertSubscription(svc, tenantId, {
            plan: meta.plan,
            cycle: meta.cycle === "yearly" ? "yearly" : "monthly",
            status: "active",
            provider: "stripe",
            stripe_customer_id: s.customer || null,
            stripe_subscription_id: s.subscription || null,
            addons: finalAddons,
          });
          await syncVoice(svc, tenantId, finalAddons);
        } else if (isPlan) {
          await upsertSubscription(svc, tenantId, {
            plan: meta.plan,
            cycle: meta.cycle === "yearly" ? "yearly" : "monthly",
            status: "active",
            provider: "stripe",
            stripe_customer_id: s.customer || null,
            stripe_subscription_id: s.subscription || null,
          });
        } else if (isAddon) {
          // Merge the add-on into the existing add-on list.
          const { data: existing } = await svc
            .from("subscriptions")
            .select("addons")
            .eq("tenant_id", tenantId)
            .maybeSingle();
          const addons = new Set<string>(existing?.addons || []);
          addons.add(meta.addon);
          const finalAddons = Array.from(addons);
          await upsertSubscription(svc, tenantId, {
            addons: finalAddons,
            provider: "stripe",
            stripe_customer_id: s.customer || undefined,
          });
          await syncVoice(svc, tenantId, finalAddons);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const tenantId = await tenantFromStripeSub(svc, sub.id, sub.customer);
        if (!tenantId) break;
        await upsertSubscription(svc, tenantId, {
          status: mapStripeStatus(sub.status),
          current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : undefined,
          cancel_at_period_end: !!sub.cancel_at_period_end,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const tenantId = await tenantFromStripeSub(svc, sub.id, sub.customer);
        if (!tenantId) break;
        await upsertSubscription(svc, tenantId, { status: "canceled" });
        break;
      }

      default:
        // Ignore everything else — return 200 so Stripe stops retrying.
        break;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    // 500 → Stripe retries with backoff; safe because upserts are idempotent.
    return NextResponse.json({ error: "handler_error", detail: e?.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Flip settings.voice.provider to match the paid voice add-on (voice_vapi → Vapi,
// voice_retell → Retell). Best-effort and AFTER the billing mirror is already
// written: a voice-sync failure must never fail the webhook and make Stripe retry
// a payment we've already recorded. The actual agent/number provisioning is staged
// (settings.voice.provisioning="pending") for an out-of-band reconcile, not fired here.
async function syncVoice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  tenantId: string,
  addons: string[],
): Promise<void> {
  try {
    await syncVoiceProviderFromBilling(svc, tenantId, addons);
  } catch (e) {
    console.error("[stripe webhook] voice provider sync failed", { tenantId, error: e });
  }
}

function mapStripeStatus(s: string): "active" | "trialing" | "past_due" | "canceled" | "incomplete" {
  switch (s) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      return "incomplete";
  }
}

async function tenantFromStripeSub(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  subscriptionId: string,
  customerId?: string,
): Promise<string | null> {
  const { data: bySub } = await svc
    .from("subscriptions")
    .select("tenant_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (bySub?.tenant_id) return bySub.tenant_id;
  if (customerId) {
    const { data: byCust } = await svc
      .from("subscriptions")
      .select("tenant_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (byCust?.tenant_id) return byCust.tenant_id;
  }
  return null;
}
