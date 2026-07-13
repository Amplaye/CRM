import { NextRequest, NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";

// GET /api/credits/events?tenant_id=…&limit=50
//
// The ledger behind Settings → Credits → "recent activity". Read-only, newest
// first, capped — this is a transparency view, not an export.
//
// `cost_eur` (our real cost, and therefore our margin) is deliberately NOT
// selected: it's on the row for the admin side, and the tenant has no business
// seeing what we pay Meta.

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  const requested = Number(req.nextUrl.searchParams.get("limit")) || 50;
  const limit = Math.min(Math.max(1, requested), MAX_LIMIT);

  const { data, error } = await auth.svc
    .from("credit_events")
    .select("id, action_type, credits_mc, metadata, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, events: data || [] });
}
