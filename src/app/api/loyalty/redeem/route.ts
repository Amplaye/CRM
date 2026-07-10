import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { getFeatures } from "@/lib/types/tenant-settings";
import { getLoyaltyConfig } from "@/lib/loyalty/loyalty";
import { logAuditEvent } from "@/lib/audit";

// Staff-triggered reward redemption from the guest panel: burns reward_points
// from the guest's balance and writes the negative ledger event. The actual
// perk (free dessert, discount…) is applied by the staff at the till — this
// records that the reward was claimed so points can't be spent twice.

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const guestId = String(body.guest_id || "");
    if (!tenantId || !guestId) {
      return NextResponse.json({ error: "tenant_id and guest_id required" }, { status: 400 });
    }
    const member = await verifyTenantMembership(tenantId, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const svc = createServiceRoleClient();
    const { data: tenant } = await svc
      .from("tenants")
      .select("settings")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant || !getFeatures(tenant.settings).loyalty_enabled) {
      return NextResponse.json({ error: "not_available" }, { status: 403 });
    }
    const cfg = getLoyaltyConfig(tenant.settings);

    const { data: account } = await svc
      .from("loyalty_accounts")
      .select("id, points")
      .eq("tenant_id", tenantId)
      .eq("guest_id", guestId)
      .maybeSingle();
    if (!account || account.points < cfg.reward_points) {
      return NextResponse.json(
        { error: "insufficient_points", points: account?.points ?? 0, required: cfg.reward_points },
        { status: 409 },
      );
    }

    // Optimistic lock on the balance we just read — a concurrent redemption
    // makes this match nothing and the staff simply retries with fresh state.
    const { data: updated } = await svc
      .from("loyalty_accounts")
      .update({ points: account.points - cfg.reward_points, updated_at: new Date().toISOString() })
      .eq("id", account.id)
      .eq("points", account.points)
      .select("points")
      .maybeSingle();
    if (!updated) {
      return NextResponse.json({ error: "conflict_retry" }, { status: 409 });
    }

    await svc.from("loyalty_events").insert({
      tenant_id: tenantId,
      guest_id: guestId,
      points_delta: -cfg.reward_points,
      reason: cfg.reward_label ? `reward: ${cfg.reward_label}` : "reward",
      created_by: member.userId,
    });

    await logAuditEvent({
      tenant_id: tenantId,
      action: "loyalty.redeem",
      entity_id: guestId,
      source: "staff",
      details: { points: cfg.reward_points, reward: cfg.reward_label || null, remaining: updated.points },
    });

    return NextResponse.json({ success: true, points: updated.points });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return NextResponse.json({ error: "server_error", detail: e?.message }, { status: 500 });
  }
}
