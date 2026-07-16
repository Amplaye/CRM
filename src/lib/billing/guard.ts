import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { hasManagement, hasActivePlan } from "./entitlements";

// Server-side entitlement guard for the management (gestionale) module — the REAL
// enforcement. Hiding the sidebar item and the page behind ManagementLocked is
// only the visible half: a determined user could still POST straight to the POS /
// invoice APIs. These routes therefore call assertManagement() and bail with 403
// when the smart_inventory add-on isn't active (paid+current, in grace, or the
// admin manual override). One place, so the rule can't drift between routes.

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Returns a 403 NextResponse when the tenant may NOT use the management module,
 * or `null` when it may (caller proceeds). Loads the tenant's settings with the
 * service-role client and runs them through hasManagement (manual override + paid
 * add-on + 7-day grace). Pass an existing client to reuse the request connection.
 *
 * Fail-CLOSED: if the tenant can't be read we deny — a paid feature must not leak
 * on a transient miss. (Feature flags that only shape bot tone fail open; a
 * billing gate does not.)
 */
export async function assertManagement(
  tenantId: string,
  client?: ServiceClient,
): Promise<NextResponse | null> {
  const svc = client ?? createServiceRoleClient();
  const { data } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  if (!data) {
    return NextResponse.json({ error: "management_addon_required" }, { status: 403 });
  }
  if (!hasManagement(data.settings as Parameters<typeof hasManagement>[0])) {
    return NextResponse.json({ error: "management_addon_required" }, { status: 403 });
  }
  return null;
}

/**
 * Returns a 403 NextResponse when the tenant has NO active plan (an "entry
 * package" tenant — menu + settings only), or `null` when it does (caller
 * proceeds). The server backstop for the core CRM sections (reservations,
 * waitlist, guests, conversations, analytics, knowledge): the page-level
 * LockedPreview is cosmetic, and the bot/dashboard data routes run as service-role
 * (which BYPASSES RLS), so without this a no-plan tenant could still drive
 * bookings/reads straight through the API.
 *
 * Fail-CLOSED: an unreadable tenant denies, exactly like assertManagement — a paid
 * gate must not leak on a transient miss. Do NOT call this on the public menu
 * (/m/<slug>), /menu or /settings routes, billing, or the gestionale routes (which
 * keep their own add-on rule); those must stay open for entry-package tenants.
 */
export async function assertActivePlan(
  tenantId: string,
  client?: ServiceClient,
): Promise<NextResponse | null> {
  const svc = client ?? createServiceRoleClient();
  const { data } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  if (!data || !hasActivePlan(data.settings as Parameters<typeof hasActivePlan>[0])) {
    return NextResponse.json({ error: "plan_required" }, { status: 403 });
  }
  return null;
}
