import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

// Generates a single-use, short-lived token that the owner/manager renders as
// a QR code. The staff member scans it on their phone, hits /qr-login?t=...
// which exchanges it for a Supabase magic-link session.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { userId?: string; tenantId?: string };
    const targetUserId = (body.userId || "").trim();
    const tenantId = (body.tenantId || "").trim();

    if (!targetUserId || !tenantId) {
      return NextResponse.json({ error: "Missing userId or tenantId" }, { status: 400 });
    }

    const userClient = await createServerSupabaseClient();
    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [{ data: callerMembership }, { data: callerProfile }] = await Promise.all([
      userClient.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", caller.id).maybeSingle(),
      userClient.from("users").select("global_role").eq("id", caller.id).maybeSingle(),
    ]);
    const isPlatformAdmin = callerProfile?.global_role === "platform_admin";
    const callerRole = (callerMembership as any)?.role;
    if (!isPlatformAdmin && callerRole !== "owner" && callerRole !== "manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createServiceRoleClient();

    // Confirm the target really is a member of this tenant.
    const { data: targetMembership } = await admin
      .from("tenant_members")
      .select("role, users(email)")
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!targetMembership) {
      return NextResponse.json({ error: "User is not a member of this tenant" }, { status: 404 });
    }

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin
      .from("qr_login_tokens")
      .insert({
        token,
        tenant_id: tenantId,
        user_id: targetUserId,
        created_by: caller.id,
        expires_at: expiresAt,
      });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const origin = req.nextUrl.origin;
    const url = `${origin}/qr-login?t=${token}`;
    return NextResponse.json({ url, expiresAt });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
