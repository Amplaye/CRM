import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { hasManagement } from "./entitlements";

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
