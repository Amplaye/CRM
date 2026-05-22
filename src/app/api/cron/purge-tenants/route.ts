import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { purgeTenant } from "@/lib/tenants/delete-tenant";
import { logSystemEvent } from "@/lib/system-log";

// Daily cron (vercel.json). Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServiceRoleClient();
  const { data: due } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("status", "archived")
    .lte("purge_after", new Date().toISOString());

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const t of due || []) {
    try {
      const r = await purgeTenant(supabase, t.id);
      await logSystemEvent({
        tenant_id: null,
        category: "system",
        severity: "low", // informational audit event, not a bug
        title: `Tenant purged (auto): ${r.tenantName}`,
        metadata: { tenant_id: t.id, ...r },
      });
      results.push({ id: t.id, ok: true });
    } catch (e: any) {
      await logSystemEvent({
        tenant_id: null,
        category: "system",
        severity: "high",
        title: `Tenant purge failed: ${t.name}`,
        metadata: { tenant_id: t.id, error: e?.message },
      });
      results.push({ id: t.id, ok: false, error: e?.message });
    }
  }
  return NextResponse.json({
    checked: (due || []).length,
    purged: results.filter((r) => r.ok).length,
    results,
  });
}
