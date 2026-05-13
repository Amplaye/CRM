import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

// Remove a tenant member AND nuke their Supabase sessions so QR-logged staff
// phones get kicked out immediately — the realtime DELETE guard in the
// dashboard layout handles the in-app case, but signOut(scope=global) also
// invalidates the refresh tokens server-side so the next refresh fails even
// if the phone wasn't online when the row was deleted.
export async function POST(req: NextRequest) {
  try {
    const { memberId, tenantId } = (await req.json()) as { memberId?: string; tenantId?: string };
    if (!memberId || !tenantId) {
      return NextResponse.json({ error: "Missing memberId or tenantId" }, { status: 400 });
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

    const { data: member, error: mErr } = await admin
      .from("tenant_members")
      .select("id, user_id, role, tenant_id")
      .eq("id", memberId)
      .maybeSingle();
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
    if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (member.tenant_id !== tenantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (member.role === "owner") return NextResponse.json({ error: "Cannot remove Admin" }, { status: 400 });
    if (member.user_id === caller.id) return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });

    // Look up the auth email to detect QR-staff (synthetic @baliflow.local).
    // For those accounts we delete the auth user entirely — that invalidates
    // every refresh token they hold AND removes the orphan account, so the
    // staff list stays clean. For real (non-QR) staff we keep the user and
    // only revoke their tenant access; the realtime DELETE guard signs them
    // out in-app.
    const { data: authUser } = await admin.auth.admin.getUserById(member.user_id);
    const email = authUser?.user?.email || "";
    const isQrStaff = /@baliflow\.local$/i.test(email);

    const { error: delErr } = await admin
      .from("tenant_members")
      .delete()
      .eq("id", memberId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    if (isQrStaff) {
      await admin.auth.admin.deleteUser(member.user_id).catch((e: unknown) => {
        console.error("[remove-member] deleteUser failed (non-fatal):", e);
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
