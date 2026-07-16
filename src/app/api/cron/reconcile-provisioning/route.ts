import { NextRequest, NextResponse } from "next/server";
import { reconcileProvisioning } from "@/lib/tenants/reconcile-provisioning";
import { logSystemEvent } from "@/lib/system-log";

// Daily cron (vercel.json). Self-heals any tenant left "active but unroutable"
// by a partial onboarding run — backfills settings.provisioning.sandbox_routable
// when the bot's n8n workflows are demonstrably live. Idempotent: on a healthy
// fleet it repairs nothing. See src/lib/tenants/reconcile-provisioning.ts.
//
// Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await reconcileProvisioning(false);

  // Only log when something was actually repaired — keep the audit trail signal,
  // not a daily "0 repaired" line.
  if (result.repaired > 0) {
    await logSystemEvent({
      tenant_id: null,
      category: "system",
      severity: "medium", // a tenant was silently broken until now — worth noticing
      title: `Provisioning auto-repair: ${result.repaired} tenant(s) made routable`,
      metadata: { repairs: result.repairs },
    });
  }

  return NextResponse.json(result);
}
