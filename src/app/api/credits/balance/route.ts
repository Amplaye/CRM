import { NextRequest, NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import { getCreditBalance } from "@/lib/billing/credits";

// GET /api/credits/balance?tenant_id=…
//
// The Topbar badge's first read (afterwards it rides the realtime subscription
// on credit_balances, so this is called once at mount — not polled).
//
// User-authenticated + membership-checked: a wallet is tenant-private. The route
// only READS; the balance is written exclusively by the RPCs behind service-role.

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  const balance = await getCreditBalance(tenantId, auth.svc);
  return NextResponse.json({
    ok: true,
    included_remaining_mc: balance.includedRemainingMc,
    purchased_remaining_mc: balance.purchasedRemainingMc,
    included_granted_mc: balance.includedGrantedMc,
    total_remaining_mc: balance.totalRemainingMc,
    period_start: balance.periodStart,
  });
}
