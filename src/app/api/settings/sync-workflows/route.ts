import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { resyncTenantWorkflows } from "@/lib/onboarding/resync-workflows";

// Propagate a change to the three baked contact fields (owner_phone,
// restaurant_phone, review_url) into the tenant's per-tenant cloned auxiliary
// n8n workflows (reminders, daily summary, post-dinner follow-up, …). These
// still bake the values at clone time (substitute.ts), so a later edit in
// Settings → Bookings would otherwise reach the DB but not those flows.
//
// SAFETY: the SHARED motore unico (166QnQsGHqXDpBxa) reads its config LIVE from
// the DB and is excluded — see resyncTenantWorkflows. Auth mirrors
// /api/sync-kb-vapi: a signed-in owner/manager of the tenant.
//
// ARCHITECTURAL NOTE: this is the pragmatic patch. The definitive fix is to make
// the auxiliary workflows read those values LIVE from the DB and drop the baking
// + this re-sync (see substitute.ts / resync-workflows.ts).

export async function POST(req: NextRequest) {
  try {
    const session = await createServerSupabaseClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const tenant_id: string = body?.tenant_id;
    if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });

    const member = await verifyTenantMembership(tenant_id, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const summary = await resyncTenantWorkflows(
      tenant_id,
      {
        oldOwnerPhone: String(body.oldOwnerPhone ?? "").trim(),
        newOwnerPhone: String(body.newOwnerPhone ?? "").trim(),
        oldRestaurantPhone: String(body.oldRestaurantPhone ?? "").trim(),
        newRestaurantPhone: String(body.newRestaurantPhone ?? "").trim(),
        oldReviewUrl: String(body.oldReviewUrl ?? "").trim(),
        newReviewUrl: String(body.newReviewUrl ?? "").trim(),
      },
      { dryRun: !!body.dryRun },
    );

    return NextResponse.json({ success: true, ...summary });
  } catch (err: unknown) {
    console.error("[settings/sync-workflows] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
