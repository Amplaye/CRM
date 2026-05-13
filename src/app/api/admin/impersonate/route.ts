import { NextRequest, NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { logAuditEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  let body: { tenant_id?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tenantId = body.tenant_id;
  if (tenantId) {
    await logAuditEvent({
      tenant_id: tenantId,
      action: "admin_impersonate_tenant",
      entity_id: auth.userId,
      source: "staff",
      details: { admin_user_id: auth.userId },
    });
  }
  return NextResponse.json({ ok: true });
}
