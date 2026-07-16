import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { syncConnection, type PosConnectionRow } from "@/lib/pos/sync";
import { logSystemEvent } from "@/lib/system-log";
import { hasManagement } from "@/lib/billing/entitlements";

// Hourly cron (vercel.json). Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
// Loops every active POS connection and pulls new sales into the canonical
// tables. Idempotent (upsert on external_id), so an overlapping window is safe.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data: connections } = await supabase
    .from("pos_connections")
    .select("id, tenant_id, provider, active, config, last_sync_at")
    .eq("active", true);

  // Paid add-on gate: only sync tenants whose gestionale (smart_inventory) is
  // active. A lapsed/unentitled tenant keeps its stored connection but we stop
  // pulling sales — no point spending till-API calls on a feature they can't see.
  // Load the involved tenants' settings once (not per-connection) and filter.
  const tenantIds = Array.from(new Set(((connections || []) as PosConnectionRow[]).map((c) => c.tenant_id)));
  const entitled = new Set<string>();
  if (tenantIds.length > 0) {
    const { data: tenants } = await supabase.from("tenants").select("id, settings").in("id", tenantIds);
    for (const t of tenants || []) {
      if (hasManagement((t as { settings: unknown }).settings as Parameters<typeof hasManagement>[0])) {
        entitled.add((t as { id: string }).id);
      }
    }
  }

  const results = [];
  let skipped = 0;
  for (const c of (connections || []) as PosConnectionRow[]) {
    if (!entitled.has(c.tenant_id)) { skipped++; continue; }
    const r = await syncConnection(supabase, c);
    results.push(r);
    if (r.status === "error") {
      await logSystemEvent({
        tenant_id: c.tenant_id,
        category: "api_error",
        severity: "high",
        title: `POS sync failed (${c.provider})`,
        metadata: { connection_id: c.id, error: r.error },
        error_key: `pos_sync_${c.id}`,
      });
    }
  }

  return NextResponse.json({
    synced: results.length,
    skipped, // active connections whose tenant lacks the gestionale add-on
    upserted: results.reduce((s, r) => s + r.upserted, 0),
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
}
