import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logSystemEvent } from "@/lib/system-log";
import { planRetention } from "@/lib/compliance/retention";

// Daily cron (vercel.json). Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
//
// Data-minimization pass: for every tenant that OPTED IN to a retention policy
// (a configured country or explicit retention_days), delete closed conversation
// transcripts older than that tenant's retention window. Reservations (business
// records) and the consent ledger are deliberately untouched. Tenants with no
// compliance config never appear in the plan, so nothing is purged by surprise.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Only pull tenants that could possibly have a policy (any compliance block).
  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, name, settings")
    .in("status", ["active", "trial"]);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const plan = planRetention((tenants || []).map((t: any) => ({ id: t.id, settings: t.settings })), new Date());

  const results: Array<{ tenant_id: string; deleted: number; error?: string }> = [];
  let totalDeleted = 0;

  for (const entry of plan) {
    try {
      // Delete transcripts created before the cutoff. reservations.linked_conversation_id
      // is `on delete set null`, so past bookings keep their rows (link just clears).
      const { data: deleted, error: delErr } = await supabase
        .from("conversations")
        .delete()
        .eq("tenant_id", entry.tenant_id)
        .lt("created_at", entry.cutoff)
        .select("id");
      if (delErr) {
        results.push({ tenant_id: entry.tenant_id, deleted: 0, error: delErr.message });
        continue;
      }
      const n = deleted?.length || 0;
      totalDeleted += n;
      results.push({ tenant_id: entry.tenant_id, deleted: n });
    } catch (e: any) {
      results.push({ tenant_id: entry.tenant_id, deleted: 0, error: e?.message });
    }
  }

  // One informational system log summarizing the run (best-effort, wrapped).
  try {
    await logSystemEvent({
      tenant_id: null,
      category: "system",
      severity: "low",
      title: `Data retention run: ${totalDeleted} transcript(s) purged across ${plan.length} tenant(s)`,
      metadata: { planned: plan.length, totalDeleted, results },
    });
  } catch {
    /* logging must never break the cron */
  }

  return NextResponse.json({ planned: plan.length, totalDeleted, results });
}
