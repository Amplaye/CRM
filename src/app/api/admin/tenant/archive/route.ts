import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { archiveTenant } from "@/lib/tenants/delete-tenant";
import { buildTenantExport, uploadTenantExport } from "@/lib/tenants/export-tenant";
import { logAuditEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const { tenant_id, confirm_name } = await req.json();
    if (!tenant_id || !confirm_name) {
      return NextResponse.json({ error: "Missing tenant_id or confirm_name" }, { status: 400 });
    }
    const supabase = createServiceRoleClient();
    const { data: tenant } = await supabase.from("tenants").select("id, name, status").eq("id", tenant_id).single();
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if (String(confirm_name).trim() !== tenant.name) {
      return NextResponse.json({ error: "name_mismatch" }, { status: 400 });
    }

    // Backup first; surface the failure but don't block archiving.
    let signedUrl: string | null = null;
    let exportPath: string | undefined;
    let exportError: string | undefined;
    try {
      const data = await buildTenantExport(supabase, tenant_id);
      const up = await uploadTenantExport(supabase, tenant_id, data);
      signedUrl = up.signedUrl;
      exportPath = up.path;
    } catch (e: any) {
      exportError = e?.message || "export failed";
    }

    const { purge_after } = await archiveTenant(supabase, tenant_id, { exportPath });

    await logAuditEvent({
      tenant_id,
      action: "tenant.archived",
      entity_id: tenant_id,
      source: "staff",
      agent_id: auth.userId,
      details: { purge_after, export_path: exportPath ?? null, export_error: exportError ?? null },
    });
    return NextResponse.json({ ok: true, purge_after, download_url: signedUrl, export_error: exportError ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
