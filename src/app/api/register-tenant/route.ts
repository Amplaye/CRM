import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { createTenant } from "@/lib/tenants/create-tenant";

export async function POST(req: NextRequest) {
  try {
    // M4: derive the owner from the session, never from the request body —
    // otherwise anyone could create a tenant owned by an arbitrary user id.
    const authClient = await createServerSupabaseClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = user.id;

    const { businessName } = await req.json();
    if (!businessName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Idempotency: if this user already belongs to a tenant, don't create a
    // duplicate on a retry.
    const { data: existingMember } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", userId)
      .limit(1);
    if (existingMember && existingMember.length > 0) {
      return NextResponse.json({ status: "already_setup", tenantId: existingMember[0].tenant_id });
    }

    // Self-signup → "trial": live to evaluate, not yet a paying client.
    // The bot isn't provisioned yet — `onboarding.completed:false` is the
    // explicit signal that routes the owner into the self-serve wizard
    // (see /onboarding + the dashboard guard). Legacy tenants lack this marker
    // and are therefore never force-redirected.
    const tenant = await createTenant(supabase, {
      name: businessName,
      status: "trial",
      settings: {
        timezone: "Europe/Rome",
        currency: "EUR",
        ai_enabled_channels: [],
        onboarding: { completed: false }
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
