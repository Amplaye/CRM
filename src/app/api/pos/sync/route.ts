import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertAiSecret } from "@/lib/ai-auth";
import { assertRateLimit } from "@/lib/rate-limit";
import { syncConnection, type PosConnectionRow } from "@/lib/pos/sync";

// Manual sync trigger — the "Sincronizza ora" button / tests. Protected by the
// shared AI secret (x-ai-secret) + rate limit, same as the /api/ai/* routes.
// Body: { tenant_id } syncs that tenant's active connection(s); no body syncs
// all active connections (parity with the cron, for smoke tests).
export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  const rl = await assertRateLimit(request, "pos:sync", { max: 30, windowSecs: 60 });
  if (rl) return rl;

  let tenantId: string | undefined;
  try {
    const body = await request.json();
    tenantId = body?.tenant_id;
  } catch {
    // no body → sync all
  }

  const supabase = createServiceRoleClient();
  let query = supabase
    .from("pos_connections")
    .select("id, tenant_id, provider, active, config, last_sync_at")
    .eq("active", true);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data: connections } = await query;

  const results = [];
  for (const c of (connections || []) as PosConnectionRow[]) {
    results.push(await syncConnection(supabase, c));
  }

  return NextResponse.json({
    synced: results.length,
    upserted: results.reduce((s, r) => s + r.upserted, 0),
    skipped: results.reduce((s, r) => s + r.skipped, 0),
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
}
