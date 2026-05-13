import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

const ALLOWED_DB_ROLES = new Set(["owner", "manager", "host"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; role?: string; tenantId?: string };
    const email = (body.email || "").trim().toLowerCase();
    const role = (body.role || "").trim();
    const tenantId = (body.tenantId || "").trim();

    if (!email || !role || !tenantId) {
      return NextResponse.json({ error: "Missing email, role or tenantId" }, { status: 400 });
    }
    if (!ALLOWED_DB_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const userClient = await createServerSupabaseClient();
    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Caller must be owner/manager of this tenant (or platform admin)
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

    // 1) Find or invite the user
    let targetUserId: string | null = null;

    const { data: existingProfile } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingProfile?.id) {
      targetUserId = existingProfile.id as string;
    } else {
      const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
      if (inviteErr || !invited?.user?.id) {
        return NextResponse.json({ error: inviteErr?.message || "Invite failed" }, { status: 500 });
      }
      targetUserId = invited.user.id;
    }

    // 2) Check if already a member of this tenant
    const { data: existingMember } = await admin
      .from("tenant_members")
      .select("id, role")
      .eq("tenant_id", tenantId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (existingMember) {
      return NextResponse.json({ error: "User is already a member of this tenant" }, { status: 409 });
    }

    // 3) Insert the membership
    const { error: memberErr } = await admin
      .from("tenant_members")
      .insert({ tenant_id: tenantId, user_id: targetUserId, role });

    if (memberErr) {
      return NextResponse.json({ error: memberErr.message }, { status: 500 });
    }

    return NextResponse.json({ status: "ok", userId: targetUserId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
