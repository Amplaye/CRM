// Admin cross-tenant billing read-model. Unifies the TWO billing flows into one
// row shape so the Billing console table and the Fleet/Billing summary strip read
// the exact same numbers:
//   • public.subscriptions      — steady-state plans (premium/business)
//   • public.pilot_subscriptions— €150 pilot → trial → sub (founder/premium)
// The catalogs diverge (different plan ids AND prices), so MRR is computed with
// the correct price source per row. READ-ONLY: no Stripe calls, DB only.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getPlan, getAddon, type PlanId, type AddonId } from "./catalog";
import { PILOT_PLANS, type PilotPlan } from "./pilot";

export type BillingRowSource = "sub" | "pilot";
export type BillingStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";

export interface BillingRow {
  source: BillingRowSource;
  tenantId: string | null;
  tenantName: string | null;
  plan: string | null;
  status: BillingStatus;
  cycle: string | null;
  provider: string | null;
  /** Monthly-equivalent recurring revenue in whole EUR (0 unless active/trialing). */
  mrr: number;
  /** Renewal or trial-end instant (ISO). */
  renewal: string | null;
  cancelAtPeriodEnd: boolean;
  addons: string[];
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Pilot-only context for unlinked leads. */
  customerEmail: string | null;
  businessName: string | null;
  updatedAt: string | null;
}

export interface BillingSummary {
  mrr: number;
  arr: number;
  total: number;
  activeCount: number;
  trialing: number;
  trialsEndingSoon: number;
  pastDue: number;
  canceled30: number;
}

function subMrr(plan: PlanId | null, cycle: string | null, addons: string[]): number {
  if (!plan) return 0;
  const p = getPlan(plan);
  if (!p) return 0;
  const planMonthly = cycle === "yearly" ? Math.round(p.yearly / 12) : p.monthly;
  const addonsMonthly = (addons || []).reduce((sum, id) => {
    const a = getAddon(id as AddonId);
    return a && a.billing === "recurring" ? sum + a.amount : sum;
  }, 0);
  return planMonthly + addonsMonthly;
}

function pilotMrr(plan: PilotPlan, cycle: string | null): number {
  const cfg = PILOT_PLANS[plan];
  if (!cfg) return 0;
  const annual = cycle === "annual" || cycle === "yearly";
  return annual
    ? Math.round(cfg.recurringCents.annual / 100 / 12)
    : Math.round(cfg.recurringCents.monthly / 100);
}

const EARNING = (s: BillingStatus) => s === "active" || s === "trialing";

/** Load + normalize every billing row across both flows (service-role). */
export async function getBillingRows(): Promise<BillingRow[]> {
  const svc = createServiceRoleClient();
  const [subsRes, pilotRes, tenantsRes] = await Promise.all([
    svc
      .from("subscriptions")
      .select(
        "tenant_id, plan, cycle, status, provider, addons, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, updated_at",
      ),
    svc
      .from("pilot_subscriptions")
      .select(
        "tenant_id, plan, subscription_status, current_period_end, pilot_end, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, customer_email, business_name, metadata, updated_at",
      ),
    svc.from("tenants").select("id, name"),
  ]);

  const nameById = new Map<string, string>();
  for (const t of (tenantsRes.data || []) as Array<{ id: string; name: string }>) {
    nameById.set(t.id, t.name);
  }

  const rows: BillingRow[] = [];

  for (const s of (subsRes.data || []) as any[]) {
    const addons = Array.isArray(s.addons) ? s.addons : [];
    const status = (s.status || "incomplete") as BillingStatus;
    rows.push({
      source: "sub",
      tenantId: s.tenant_id ?? null,
      tenantName: s.tenant_id ? nameById.get(s.tenant_id) ?? null : null,
      plan: s.plan ?? null,
      status,
      cycle: s.cycle ?? null,
      provider: s.provider ?? null,
      mrr: EARNING(status) ? subMrr(s.plan ?? null, s.cycle ?? null, addons) : 0,
      renewal: s.current_period_end ?? null,
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
      addons,
      stripeCustomerId: s.stripe_customer_id ?? null,
      stripeSubscriptionId: s.stripe_subscription_id ?? null,
      customerEmail: null,
      businessName: null,
      updatedAt: s.updated_at ?? null,
    });
  }

  for (const p of (pilotRes.data || []) as any[]) {
    const status = (p.subscription_status || "incomplete") as BillingStatus;
    const cycle = (p.metadata?.cycle as string) || "monthly";
    const plan = p.plan as PilotPlan;
    rows.push({
      source: "pilot",
      tenantId: p.tenant_id ?? null,
      tenantName: p.tenant_id ? nameById.get(p.tenant_id) ?? null : null,
      plan: p.plan ?? null,
      status,
      cycle,
      provider: "stripe",
      mrr: EARNING(status) ? pilotMrr(plan, cycle) : 0,
      renewal: p.current_period_end ?? p.pilot_end ?? null,
      cancelAtPeriodEnd: !!p.cancel_at_period_end,
      addons: [],
      stripeCustomerId: p.stripe_customer_id ?? null,
      stripeSubscriptionId: p.stripe_subscription_id ?? null,
      customerEmail: p.customer_email ?? null,
      businessName: p.business_name ?? null,
      updatedAt: p.updated_at ?? null,
    });
  }

  return rows;
}

/** Roll the unified rows into the top-of-page totals. */
export function summarize(rows: BillingRow[], now: number = Date.now()): BillingSummary {
  const SEVEN = 7 * 24 * 60 * 60 * 1000;
  const THIRTY = 30 * 24 * 60 * 60 * 1000;
  let mrr = 0;
  let activeCount = 0;
  let trialing = 0;
  let trialsEndingSoon = 0;
  let pastDue = 0;
  let canceled30 = 0;

  for (const r of rows) {
    if (EARNING(r.status)) mrr += r.mrr;
    if (r.status === "active") activeCount++;
    if (r.status === "trialing") {
      trialing++;
      if (r.renewal) {
        const t = Date.parse(r.renewal);
        if (!Number.isNaN(t) && t >= now && t - now <= SEVEN) trialsEndingSoon++;
      }
    }
    if (r.status === "past_due") pastDue++;
    if (r.status === "canceled" && r.updatedAt) {
      const t = Date.parse(r.updatedAt);
      if (!Number.isNaN(t) && now - t <= THIRTY) canceled30++;
    }
  }

  return { mrr, arr: mrr * 12, total: rows.length, activeCount, trialing, trialsEndingSoon, pastDue, canceled30 };
}
