import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";

// Save the owner's reply to a review (or hide/unhide it). The reply lives on
// the review row and shows on the public site (Fase 4); publishing to Google
// isn't possible via API — the owner answers Google reviews on Google.

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const reviewId = String(body.review_id || "");
    if (!tenantId || !reviewId) {
      return NextResponse.json({ error: "tenant_id and review_id required" }, { status: 400 });
    }
    const member = await verifyTenantMembership(tenantId, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const svc = createServiceRoleClient();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.reply === "string") {
      patch.reply = body.reply.slice(0, 2000).trim() || null;
      patch.reply_at = patch.reply ? new Date().toISOString() : null;
      patch.status = patch.reply ? "replied" : "new";
    }
    if (body.status === "hidden" || body.status === "new") patch.status = body.status;

    const { error } = await svc
      .from("reviews")
      .update(patch)
      .eq("id", reviewId)
      .eq("tenant_id", tenantId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[reviews/reply]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
