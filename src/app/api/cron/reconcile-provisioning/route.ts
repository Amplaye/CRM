import { NextRequest, NextResponse } from "next/server";
import { reconcileProvisioning } from "@/lib/tenants/reconcile-provisioning";
import { logSystemEvent } from "@/lib/system-log";

// Daily cron. Keeps the Worker's KV `sandbox:tenants` routing list in sync with
// the DB: re-registers every active + sandbox_routable tenant (idempotent upsert),
// so a tenant can't silently drop out of the shared "which restaurant?" menu if
// its onboarding-time registration ever failed. See reconcile-provisioning.ts.
//
// Sends `Authorization: Bearer ${CRON_SECRET}`.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await reconcileProvisioning(false);

  // Log only if the registry was unreachable for some tenant (a real problem);
  // a clean re-sync is routine and shouldn't spam the audit trail daily.
  if (result.skipped.some((s) => s.why.includes("unreachable"))) {
    await logSystemEvent({
      tenant_id: null,
      category: "system",
      severity: "medium",
      title: `Sandbox reconcile: registry unreachable for ${result.skipped.length} tenant(s)`,
      metadata: { skipped: result.skipped },
    });
  }

  return NextResponse.json(result);
}
