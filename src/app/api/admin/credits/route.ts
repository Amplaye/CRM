import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { getCreditBalance, grantPurchasedCredits } from "@/lib/billing/credits";
import { MC_PER_CREDIT } from "@/lib/billing/credits-catalog";
import { logAuditEvent } from "@/lib/audit";

// Platform-admin credit control, per tenant (/admin/tenant/[id] → Crediti card).
//
// Why this exists: a paying restaurant that runs dry on a Saturday night can't
// wait for a Stripe checkout to clear. We need to be able to hand them credits
// on the spot — and equally, to take back credits granted by mistake.
//
// It is deliberately NOT reachable by a tenant: grant_credits is revoked from
// `authenticated` at the DB level (see the migration), so the only path to it is
// a service-role call behind assertPlatformAdmin. A tenant who could mint their
// own credits is a tenant with a free, uncapped OpenAI budget.
//
// Every grant is written to the ledger as `admin_grant` (never `topup`, which
// means "the customer paid") and to audit_events with WHO did it and WHY.
//
// GET  ?tenant_id=…                          → current balance
// POST { tenant_id, credits, reason? }       → add credits (negative = remove)

/** Nobody legitimately hands out 100k credits (€20.000) in one click; a typo
 * that adds three zeros should bounce, not go through. */
const MAX_GRANT_CREDITS = 50_000;

export async function GET(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  const tenantId = req.nextUrl.searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const balance = await getCreditBalance(tenantId, svc);

  // Recent grants/removals, so the admin can see what's already been handed out
  // (and spot a double-click) before granting more.
  const { data: recent } = await svc
    .from("credit_events")
    .select("id, action_type, credits_mc, metadata, created_at")
    .eq("tenant_id", tenantId)
    .in("action_type", ["admin_grant", "topup", "plan_reset"])
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    ok: true,
    included_remaining_mc: balance.includedRemainingMc,
    purchased_remaining_mc: balance.purchasedRemainingMc,
    included_granted_mc: balance.includedGrantedMc,
    total_remaining_mc: balance.totalRemainingMc,
    period_start: balance.periodStart,
    recent: recent || [],
  });
}

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string = body?.tenant_id || "";
  const credits = Number(body?.credits);
  const reason: string = typeof body?.reason === "string" ? body.reason.slice(0, 300) : "";

  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  if (!Number.isFinite(credits) || credits === 0) {
    return NextResponse.json({ error: "invalid_credits" }, { status: 400 });
  }
  if (Math.abs(credits) > MAX_GRANT_CREDITS) {
    return NextResponse.json({ error: "amount_too_large", max: MAX_GRANT_CREDITS }, { status: 400 });
  }

  const svc = createServiceRoleClient();

  const { data: tenant } = await svc.from("tenants").select("id, name").eq("id", tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });

  // Credits are integers in millicredits; a fractional gift (0.5 cr) is rounded
  // to the nearest mc rather than silently truncated to zero.
  const mc = Math.round(credits * MC_PER_CREDIT);

  if (mc < 0) {
    // REMOVAL. grant_credits only adds, and consume_credits refuses to overdraw,
    // so a claw-back is its own path: never take more than they actually have,
    // or the balance would go negative and every gate would read as "exhausted"
    // forever. Clamp to what's there.
    const balance = await getCreditBalance(tenantId, svc);
    const toRemove = Math.min(Math.abs(mc), balance.purchasedRemainingMc);
    if (toRemove === 0) {
      return NextResponse.json({ error: "nothing_to_remove", purchased_remaining_mc: balance.purchasedRemainingMc }, { status: 400 });
    }

    const { error } = await svc
      .from("credit_balances")
      .update({
        purchased_remaining_mc: balance.purchasedRemainingMc - toRemove,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });

    await svc.from("credit_events").insert({
      tenant_id: tenantId,
      action_type: "admin_grant",
      credits_mc: -toRemove,
      metadata: { granted_by: auth.userId, reason, removal: true },
    });

    await logAuditEvent({
      tenant_id: tenantId,
      action: "admin_credits_removed",
      entity_id: tenantId,
      source: "staff",
      details: { credits_mc: -toRemove, by: auth.userId, reason },
    });

    const after = await getCreditBalance(tenantId, svc);
    return NextResponse.json({ ok: true, removed_mc: toRemove, total_remaining_mc: after.totalRemainingMc });
  }

  // GRANT. Lands in `purchased` (never expires, survives the monthly reset) —
  // a gift we hand out shouldn't evaporate at the next renewal.
  const ok = await grantPurchasedCredits(
    tenantId,
    mc,
    { granted_by: auth.userId, reason },
    svc,
    "admin_grant",
  );
  if (!ok) return NextResponse.json({ error: "grant_failed" }, { status: 500 });

  await logAuditEvent({
    tenant_id: tenantId,
    action: "admin_credits_granted",
    entity_id: tenantId,
    source: "staff",
    details: { credits_mc: mc, by: auth.userId, reason },
  });

  const after = await getCreditBalance(tenantId, svc);
  return NextResponse.json({ ok: true, granted_mc: mc, total_remaining_mc: after.totalRemainingMc });
}
