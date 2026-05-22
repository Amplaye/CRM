import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { restoreTenant } from "@/lib/tenants/delete-tenant";
import { logAuditEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });
    const supabase = createServiceRoleClient();
    const { status } = await restoreTenant(supabase, tenant_id);
    await logAuditEvent({
      tenant_id,
      action: "tenant.restored",
      entity_id: tenant_id,
      source: "staff",
      agent_id: auth.userId,
      details: { status },
    });
    return NextResponse.json({ ok: true, status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
