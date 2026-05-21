import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createTenant } from "@/lib/tenants/create-tenant";

export async function POST(req: NextRequest) {
  try {
    const { userId, businessName } = await req.json();
    if (!userId || !businessName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Self-signup → "trial": live to evaluate, not yet a paying client.
    const tenant = await createTenant(supabase, {
      name: businessName,
      status: "trial",
      settings: {
        timezone: "Europe/Rome",
        currency: "EUR",
        ai_enabled_channels: []
      }
    });

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
