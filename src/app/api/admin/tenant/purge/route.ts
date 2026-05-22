import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { purgeTenant } from "@/lib/tenants/delete-tenant";
import { logSystemEvent } from "@/lib/system-log";

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const { tenant_id, confirm_name } = await req.json();
    if (!tenant_id || !confirm_name) {
      return NextResponse.json({ error: "Missing tenant_id or confirm_name" }, { status: 400 });
    }
    const supabase = createServiceRoleClient();
    const { data: tenant } = await supabase.from("tenants").select("id, name").eq("id", tenant_id).single();
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if (String(confirm_name).trim() !== tenant.name) {
      return NextResponse.json({ error: "name_mismatch" }, { status: 400 });
    }

    const result = await purgeTenant(supabase, tenant_id);
    // Durable record: the tenant row (and any audit_events for it) is gone, so we
    // log to system_logs with tenant_id null — that survives the cascade.
    await logSystemEvent({
      tenant_id: null,
      category: "system",
      severity: "low", // informational audit event, not a bug
      title: `Tenant purged (manual): ${result.tenantName}`,
      description: `by ${auth.userId}`,
      metadata: { tenant_id, by: auth.userId, ...result },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
