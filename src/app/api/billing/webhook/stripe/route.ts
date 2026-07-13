import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyWebhook } from "@/lib/billing/stripe";
import { upsertSubscription } from "@/lib/billing/state";
import { syncVoiceProviderFromBilling } from "@/lib/billing/voice-billing";
import { PLANS, ADDONS } from "@/lib/billing/catalog";
import { getCreditPack } from "@/lib/billing/credits-catalog";
import { grantPurchasedCredits, resetIncludedCredits } from "@/lib/billing/credits";
import { fulfillGiftCardSession } from "@/lib/gift-cards/fulfill";
import { logSystemEvent } from "@/lib/system-log";

// Stripe webhook — the ONLY trusted writer of subscription state. The browser
// never tells us "I paid"; Stripe does, signed. We verify the signature against
// STRIPE_WEBHOOK_SECRET (raw body, no SDK), then translate the handful of events
// we care about into upsertSubscription (which also mirrors settings.billing).
//
// Configure in Stripe: endpoint = /api/billing/webhook/stripe, events:
//   checkout.session.completed, checkout.session.expired,
//   customer.subscription.updated, customer.subscription.deleted,
//   invoice.paid  ← credit allowance reset on renewal; without it a tenant's
//                   monthly credits only refill via the daily cron backstop.
//
// Booking deposits (metadata.kind = "deposit") also land here: same endpoint,
// same secret — the metadata discriminates, and the deposit branch writes
// reservations.deposit_* + reservation_payments instead of subscriptions.
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

        if (kind === "deposit" && meta.reservation_id) {
          // Booking deposit paid → the hold is AUTHORIZED (capture_method:
          // manual — money moves only on forfeit). Idempotent: re-delivery
          // rewrites the same state.
          await svc
            .from("reservations")
            .update({
              deposit_status: "authorized",
              deposit_payment_intent_id: s.payment_intent || null,
              deposit_paid_at: new Date().toISOString(),
            })
            .eq("id", meta.reservation_id)
            .eq("tenant_id", tenantId);
          await svc.from("reservation_payments").insert({
            tenant_id: tenantId,
            reservation_id: meta.reservation_id,
            kind: "deposit",
            action: "authorized",
            amount_cents: Number(s.amount_total) || 0,
            currency: String(s.currency || "eur"),
            stripe_payment_intent_id: s.payment_intent || null,
            stripe_checkout_session_id: s.id,
          });
          break;
        }

        if (kind === "gift_card") {
          // Voucher paid (immediate capture) → mint code + email recipient.
          // fulfillGiftCardSession is idempotent by session id and never
          // throws; a partial failure is logged, not retried into a dup.
          const result = await fulfillGiftCardSession(svc, s);
          if (result.error) {
            await logSystemEvent({
              tenant_id: tenantId,
              category: "api_error",
              severity: result.ok ? "medium" : "high",
              title: result.ok ? "Gift card: email non inviata" : "Gift card: fulfillment fallito",
              description: `Sessione ${s.id}: ${result.error}`,
            });
          }
          break;
        }

        if (kind === "credits") {
          // Top-up paid → add the pack to the wallet. The pack SIZE is read from
          // our catalog by id, never from the session amount: the metadata is
          // attacker-visible-ish and the amount is a display value, whereas the
          // catalog is the same source of truth the price id was built from.
          const pack = getCreditPack(String(meta.pack || ""));
          if (!pack) {
            await logSystemEvent({
              tenant_id: tenantId,
              category: "api_error",
              severity: "high",
              title: "Ricarica crediti: pacchetto sconosciuto",
              description: `Sessione ${s.id}: pack="${meta.pack}" non è nel catalogo. Il cliente ha pagato e NON ha ricevuto i crediti.`,
            });
            break;
          }
          const ok = await grantPurchasedCredits(tenantId, pack.creditsMc, {
            pack: pack.id,
            stripe_session_id: s.id,
            amount_eur: pack.amount,
          });
          if (!ok) {
            // Paid but not credited — this is money taken for nothing, so it's a
            // high-severity log, not a silent failure.
            await logSystemEvent({
              tenant_id: tenantId,
              category: "api_error",
              severity: "high",
              title: "Ricarica crediti: accredito fallito",
              description: `Sessione ${s.id}: pagamento riuscito (${pack.id}, €${pack.amount}) ma grant_credits è fallito.`,
            });
          }
          break;
        }

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
          // First month's credit allowance — without this the tenant starts a
          // paid plan with an empty wallet and the bot won't answer.
          await resetIncludedCredits(tenantId, meta.plan);
        } else if (isPlan) {
          await upsertSubscription(svc, tenantId, {
            plan: meta.plan,
            cycle: meta.cycle === "yearly" ? "yearly" : "monthly",
            status: "active",
            provider: "stripe",
            stripe_customer_id: s.customer || null,
            stripe_subscription_id: s.subscription || null,
          });
          await resetIncludedCredits(tenantId, meta.plan);
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

      case "checkout.session.expired": {
        // Deposit link never paid (Checkout sessions expire after 24h) — put
        // the reservation back to 'required' so staff sees it's still owed and
        // can send a fresh link. Guarded on pending so we never regress a paid one.
        const s = event.data.object;
        const meta = s.metadata || {};
        if (meta.kind === "deposit" && meta.reservation_id && meta.tenant_id) {
          await svc
            .from("reservations")
            .update({ deposit_status: "required", deposit_checkout_session_id: null })
            .eq("id", meta.reservation_id)
            .eq("tenant_id", meta.tenant_id)
            .eq("deposit_status", "pending");
          await svc.from("reservation_payments").insert({
            tenant_id: meta.tenant_id,
            reservation_id: meta.reservation_id,
            kind: "deposit",
            action: "expired",
            amount_cents: Number(s.amount_total) || 0,
            currency: String(s.currency || "eur"),
            stripe_checkout_session_id: s.id,
          });
        }
        break;
      }

      case "invoice.paid": {
        // A recurring charge cleared → a new billing period began → the monthly
        // credit allowance resets. This is the PRIMARY reset path; the daily cron
        // (/api/cron/credits-reset) only catches the tenants this webhook missed.
        //
        // `billing_reason` matters: an invoice also gets paid when the plan is
        // FIRST bought (subscription_create), and that one is already handled by
        // checkout.session.completed above. Resetting again would be harmless
        // (resetIncludedCredits SETS, never adds) but we'd log a phantom renewal.
        const inv = event.data.object;
        if (inv.billing_reason !== "subscription_cycle") break;
        const subId = inv.subscription || inv.parent?.subscription_details?.subscription;
        const tenantId = await tenantFromStripeSub(svc, subId, inv.customer);
        if (!tenantId) break;
        const { data: subRow } = await svc
          .from("subscriptions")
          .select("plan")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        const plan = subRow?.plan;
        if (plan === "premium" || plan === "business") {
          await resetIncludedCredits(tenantId, plan);
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
  subscriptionId: string | undefined,
  customerId?: string,
): Promise<string | null> {
  // An invoice may carry no subscription id (one-off charges), so this is
  // reachable with `undefined` — fall straight through to the customer lookup
  // rather than sending `eq(col, undefined)` to postgrest.
  if (subscriptionId) {
    const { data: bySub } = await svc
      .from("subscriptions")
      .select("tenant_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (bySub?.tenant_id) return bySub.tenant_id;
  }
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
