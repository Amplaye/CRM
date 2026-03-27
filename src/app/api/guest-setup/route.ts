import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

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

    // Create a demo tenant for the guest
    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .insert({
        name: "Demo Restaurant",
        business_type: "restaurant",
        settings: { timezone: "Europe/Rome", currency: "EUR", ai_enabled_channels: ["whatsapp", "voice"] }
      })
      .select("id")
      .single();

    if (tenantErr) throw tenantErr;

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
