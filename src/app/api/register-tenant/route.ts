import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { userId, businessName, businessType } = await req.json();
    if (!userId || !businessName || !businessType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Create the tenant
    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .insert({
        name: businessName,
        business_type: businessType,
        settings: {
          timezone: "Europe/Rome",
          currency: "EUR",
          ai_enabled_channels: []
        }
      })
      .select("id")
      .single();

    if (tenantErr) throw tenantErr;

    // Add user as owner
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
