import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

// Generates a QR-login token that represents a *pending* staff invite. The
// Supabase user and tenant_members row are created lazily on first scan (see
// /qr-login). Until then nothing appears in the staff list — by design, so
// the owner only sees real, signed-in members.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; role?: string; tenantId?: string };
    const name = (body.name || "").trim();
    const role = (body.role || "host").trim();
    const tenantId = (body.tenantId || "").trim();

    if (!name || !tenantId) {
      return NextResponse.json({ error: "Missing name or tenantId" }, { status: 400 });
    }
    if (role !== "host" && role !== "manager" && role !== "owner") {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
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

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin
      .from("qr_login_tokens")
      .insert({
        token,
        tenant_id: tenantId,
        user_id: null,
        created_by: caller.id,
        pending_name: name,
        pending_role: role,
        expires_at: expiresAt,
      });
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const origin = req.nextUrl.origin;
    return NextResponse.json({ url: `${origin}/qr-login?t=${token}`, expiresAt });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
