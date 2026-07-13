import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resetIncludedCredits } from "@/lib/billing/credits";
import { logSystemEvent } from "@/lib/system-log";

// Daily cron (vercel.json — fixed minute+hour: Vercel Hobby rejects sub-daily
// schedules and the whole deploy fails). Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
//
// The BACKSTOP for the monthly allowance reset, not the primary path — the
// renewal webhook (upsertSubscription) resets credits the moment Stripe/PayPal
// confirms the payment. But a webhook can be missed: a bad deploy, a signature
// mismatch, a provider retry that gave up. If that happens the tenant simply
// stops getting their monthly credits and the bot goes quiet mid-service, which
// they experience as us breaking their restaurant.
//
// So once a day we sweep for active tenants whose allowance is older than a
// billing cycle and reset it ourselves. resetIncludedCredits SETS the quota
// (never adds), so a tenant reset by both the webhook and this cron ends up with
// exactly one allowance — the two paths cannot double-grant.

// A cycle plus a couple of days of slack: we'd rather re-grant a day late than
// re-grant a day early and hand out 13 allowances a year.
const CYCLE_DAYS = 32;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceRoleClient();
  const cutoff = new Date(Date.now() - CYCLE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Paying tenants only. A canceled/past_due subscription gets no fresh credits
  // — that's the whole point of the plan allowance being tied to the plan.
  const { data: subs, error } = await svc
    .from("subscriptions")
    .select("tenant_id, plan, status")
    .in("status", ["active", "trialing"])
    .not("plan", "is", null);

  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }

  const results: Array<{ tenant_id: string; reset: boolean }> = [];

  for (const sub of subs || []) {
    const tenantId = sub.tenant_id as string;
    const plan = sub.plan as "premium" | "business";

    const { data: bal } = await svc
      .from("credit_balances")
      .select("period_start")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    // Stale (or never granted) → the webhook didn't do its job. Grant now.
    const stale = !bal || !bal.period_start || (bal.period_start as string) < cutoff;
    if (!stale) continue;

    const ok = await resetIncludedCredits(tenantId, plan, svc);
    results.push({ tenant_id: tenantId, reset: ok });

    if (ok) {
      // Worth a log line: every row here is a renewal webhook that didn't land,
      // and a pattern of them is a billing bug worth chasing.
      try {
        await logSystemEvent({
          tenant_id: tenantId,
          category: "system",
          severity: "low",
          title: "Crediti mensili ripristinati dal cron",
          description: `Piano ${plan}: l'allowance non era stata resettata dal webhook di rinnovo.`,
        });
      } catch {
        // Logging must never break the sweep.
      }
    }
  }

  return NextResponse.json({ ok: true, checked: subs?.length || 0, reset: results.length, results });
}
