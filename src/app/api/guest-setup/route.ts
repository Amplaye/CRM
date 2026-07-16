import { NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { createTenant } from "@/lib/tenants/create-tenant";
import { apiError } from "@/lib/api-error";

export async function POST() {
  try {
    // M4: derive the user from the session, never from a body-supplied userId.
    const authClient = await createServerSupabaseClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = user.id;

    const supabase = createServiceRoleClient();

    // Check if user already has a tenant
    const { data: existing } = await supabase
      .from("tenant_members")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ status: "already_setup" });
    }

    // Demo tenant for the guest → "active": the demo must work immediately.
    const tenant = await createTenant(supabase, {
      name: "Demo Restaurant",
      status: "active",
      settings: { timezone: "Europe/Rome", currency: "EUR", ai_enabled_channels: ["whatsapp", "voice"] }
    });

    // Add user as owner of the demo tenant
    const { error: memberErr } = await supabase
      .from("tenant_members")
      .insert({
        tenant_id: tenant.id,
        user_id: userId,
        role: "owner"
      });

    if (memberErr) throw memberErr;

    return NextResponse.json({ status: "ok", tenantId: tenant.id });
  } catch (err: any) {
    return apiError(err, { route: "guest-setup", publicMessage: "operation_failed", status: 500 });
  }
}
