import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createTenant } from "@/lib/tenants/create-tenant";

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await req.json();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
