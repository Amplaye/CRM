import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

// Cancels an outstanding (unscanned) staff invite — deletes the pending
// qr_login_tokens row before it's consumed. Owner / platform-admin only, same
// gate as add-staff. Only a still-pending token (user_id null, not consumed)
// can be removed here, so this can never delete a real member's re-login token.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { tokenId?: string; tenantId?: string };
    const tokenId = (body.tokenId || "").trim();
    const tenantId = (body.tenantId || "").trim();
    if (!tokenId || !tenantId) {
      return NextResponse.json({ error: "Missing tokenId or tenantId" }, { status: 400 });
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
    if (!isPlatformAdmin && callerRole !== "owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = createServiceRoleClient();
    const { error } = await admin
      .from("qr_login_tokens")
      .delete()
      .eq("id", tokenId)
      .eq("tenant_id", tenantId)
      .is("user_id", null)      // pending only
      .is("consumed_at", null); // never delete an already-used token
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
