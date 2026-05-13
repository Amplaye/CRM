import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";

// Adds a staff member from just a name + role (no real email/password). We
// auto-generate an internal email so Supabase auth keeps working, and the
// staff member logs in via the QR-token flow (see /api/team/qr-token).
//
// Used only for the "host" (cameriere) role. Owner/Admin invitations still
// go through /api/team/invite because those people typically have real
// emails (the manager, the accountant, a business partner).
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

    // Synthetic internal email — never used to log in, just satisfies the
    // auth.users unique-email constraint. Domain ends in .local so it can
    // never resolve outside.
    const randomTag = randomBytes(6).toString("hex");
    const tenantShort = tenantId.replace(/-/g, "").slice(0, 8);
    const syntheticEmail = `staff-${randomTag}.t${tenantShort}@baliflow.local`;
    const syntheticPassword = randomBytes(24).toString("base64url");

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password: syntheticPassword,
      email_confirm: true,
      user_metadata: { name, tenant_id: tenantId, qr_staff: true },
    });
    if (createErr || !created?.user?.id) {
      return NextResponse.json({ error: createErr?.message || "User creation failed" }, { status: 500 });
    }
    const newUserId = created.user.id;

    // Trigger handle_new_user() should have inserted into public.users — but
    // it copies from raw_user_meta_data->>'name', so set it explicitly if
    // missing (defensive: trigger ordering or future schema tweaks).
    await admin.from("users").upsert({ id: newUserId, email: syntheticEmail, name }, { onConflict: "id" });

    const { error: memberErr } = await admin
      .from("tenant_members")
      .insert({ tenant_id: tenantId, user_id: newUserId, role });
    if (memberErr) {
      // Best-effort cleanup: delete the orphan auth user.
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: memberErr.message }, { status: 500 });
    }

    return NextResponse.json({ userId: newUserId, name, role });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
