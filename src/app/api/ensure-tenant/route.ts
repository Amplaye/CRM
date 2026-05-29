import { NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createTenant } from "@/lib/tenants/create-tenant";

// Self-healing tenant creation for the onboarding wizard.
//
// Why this exists: tenant creation used to happen ONLY as a browser fetch in
// register/page.tsx, fired right after signUp. If that fetch never ran or
// failed silently (flaky network, the user closing the tab between signUp and
// the call, confirming the email on a different device), the auth user existed
// with NO tenant_members row. When such an owner later confirmed their email
// and landed on /onboarding, the wizard found no tenant and bounced them to "/"
// → straight into an empty dashboard, skipping onboarding entirely. That is the
// "tap confirm → lands in dashboard, no wizard" bug Sofía hit.
//
// This endpoint makes the wizard resilient: an authenticated owner with no
// tenant gets one created on the spot, with the same `onboarding.completed:false`
// marker register-tenant writes, so the flow proceeds normally. Fully
// idempotent — if the caller already owns a tenant, we return it untouched and
// never create a second one. The tenant id is resolved from the SESSION, never
// trusted from the body.
export async function POST(req: Request) {
  try {
    // Read the optional body hint first; a missing/invalid body must not throw.
    let bodyName = "";
    try { bodyName = ((await req.json()) as any)?.businessName?.trim?.() || ""; } catch {}

    const authClient = await createServerSupabaseClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const svc = createServiceRoleClient();

    // Already a member of any tenant? Then there is nothing to create. Prefer an
    // owner row; otherwise just report the existing membership so the wizard can
    // route correctly without ever minting a duplicate tenant.
    const { data: memberships, error: memErr } = await svc
      .from("tenant_members")
      .select("tenant_id, role")
      .eq("user_id", user.id);
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

    const existingOwner = (memberships || []).find((m: { role: string }) => m.role === "owner");
    if (existingOwner) {
      return NextResponse.json({ status: "exists", tenantId: existingOwner.tenant_id, role: "owner" });
    }
    if ((memberships || []).length > 0) {
      // Belongs to a tenant as staff/manager — not an owner self-signup case.
      return NextResponse.json({ status: "exists", tenantId: memberships![0].tenant_id, role: memberships![0].role });
    }

    // No membership at all → repair: create the trial tenant the same way
    // register-tenant would have. Prefer the name the owner typed at sign-up
    // (stashed on the auth user), then any body hint, then a sensible
    // placeholder they can edit in wizard step 1.
    let businessName = bodyName;
    if (!businessName) {
      const meta = (user.user_metadata as any) || {};
      businessName =
        meta.business_name?.trim?.() ||
        meta.name?.trim?.() ||
        user.email?.split("@")[0] ||
        "Mi restaurante";
    }

    const tenant = await createTenant(svc, {
      name: businessName,
      status: "trial",
      settings: {
        timezone: "Europe/Rome",
        currency: "EUR",
        ai_enabled_channels: [],
        onboarding: { completed: false },
      },
    });

    const { error: insertErr } = await svc
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ status: "created", tenantId: tenant.id, role: "owner" });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "ensure-tenant failed" }, { status: 500 });
  }
}
