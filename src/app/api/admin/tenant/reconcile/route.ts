import { NextRequest, NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { reconcileProvisioning } from "@/lib/tenants/reconcile-provisioning";

// Manual trigger for the half-provisioned-tenant self-heal (see
// src/lib/tenants/reconcile-provisioning.ts). The daily cron runs the same
// function automatically; this lets an admin run it on demand and inspect the
// result.
//
// GET  (?dry=0 to apply)  → dry-run by default: reports what WOULD be repaired.
// POST                    → repair and report.

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const dry = req.nextUrl.searchParams.get("dry") !== "0"; // GET defaults to dry-run
  return NextResponse.json(await reconcileProvisioning(dry));
}

export async function POST() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  return NextResponse.json(await reconcileProvisioning(false));
}
