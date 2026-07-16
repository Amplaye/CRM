// Server-side billing-state helpers. The subscriptions table is the source of
// truth; tenants.settings.billing is a cheap mirror the webhooks keep in sync so
// the rest of the app can read the plan without a DB join. These helpers run with
// the service-role client (RLS would otherwise hide the row from the API route's
// own query path).

import { createServiceRoleClient } from "@/lib/supabase/server";
import type { PlanId, BillingCycle } from "./catalog";

export interface SubscriptionRow {
  tenant_id: string;
  plan: PlanId | null;
  cycle: BillingCycle | null;
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  provider: "stripe" | "paypal" | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  paypal_subscription_id: string | null;
  addons: string[];
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

/** Load the subscription row for a tenant (service-role). Returns null when the
 * tenant has never started a subscription. */
export async function getSubscription(tenantId: string): Promise<SubscriptionRow | null> {
  const svc = createServiceRoleClient();
  const { data } = await svc
    .from("subscriptions")
    .select(
      "tenant_id, plan, cycle, status, provider, stripe_customer_id, stripe_subscription_id, paypal_subscription_id, addons, current_period_end, cancel_at_period_end",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as SubscriptionRow) || null;
}

/** Upsert the subscription row AND mirror the public bits into
 * tenants.settings.billing in one place — the webhooks call this so the two stores
 * never drift. `svc` is a service-role client (the webhook has no user session). */
export async function upsertSubscription(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  tenantId: string,
  patch: Partial<SubscriptionRow>,
): Promise<void> {
  const now = new Date().toISOString();
  await svc
    .from("subscriptions")
    .upsert(
      { tenant_id: tenantId, ...patch, updated_at: now },
      { onConflict: "tenant_id" },
    );

  // Mirror into settings.billing (public metadata only).
  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  const settings = (tenant?.settings || {}) as Record<string, unknown>;
  const billingPrev = (settings.billing || {}) as Record<string, unknown>;
  const billing: Record<string, unknown> = { ...billingPrev };
  if (patch.plan !== undefined) billing.plan = patch.plan ?? undefined;
  if (patch.cycle !== undefined) billing.cycle = patch.cycle ?? undefined;
  if (patch.status !== undefined) billing.status = patch.status;
  if (patch.provider !== undefined) billing.provider = patch.provider ?? undefined;
  if (patch.current_period_end !== undefined) billing.current_period_end = patch.current_period_end ?? undefined;
  if (patch.addons !== undefined) billing.addons = patch.addons;
  if (patch.stripe_customer_id !== undefined) billing.stripe_customer_id = patch.stripe_customer_id ?? undefined;
  if (patch.stripe_subscription_id !== undefined) billing.stripe_subscription_id = patch.stripe_subscription_id ?? undefined;
  if (patch.paypal_subscription_id !== undefined) billing.paypal_subscription_id = patch.paypal_subscription_id ?? undefined;

  await svc.from("tenants").update({ settings: { ...settings, billing } }).eq("id", tenantId);
}
