import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { logAuditEvent } from "@/lib/audit";
import { gatherSubject, eraseSubject, type EraseMode } from "@/lib/compliance/dsar";

// Platform-admin DSAR handling for a single data subject (a guest) within a tenant.
//
//   GET  ?tenant_id=&guest_id=|phone=   → the full export (access + portability)
//   POST { tenant_id, guest_id|phone, mode }  → erasure ('anonymize' | 'delete')
//
// Erasure is logged to audit_events so the action itself is accountable.
export async function GET(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const tenant_id = req.nextUrl.searchParams.get("tenant_id") || "";
    const guest_id = req.nextUrl.searchParams.get("guest_id") || undefined;
    const phone = req.nextUrl.searchParams.get("phone") || undefined;
    if (!tenant_id || (!guest_id && !phone)) {
      return NextResponse.json({ error: "tenant_id and guest_id|phone required" }, { status: 400 });
    }
    const supabase = createServiceRoleClient();
    const data = await gatherSubject(supabase, tenant_id, { guest_id, phone });
    if (!data.guest) return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const { tenant_id, guest_id, phone, mode } = await req.json();
    if (!tenant_id || (!guest_id && !phone)) {
      return NextResponse.json({ error: "tenant_id and guest_id|phone required" }, { status: 400 });
    }
    const eraseMode: EraseMode = mode === "delete" ? "delete" : "anonymize";
    const supabase = createServiceRoleClient();
    const result = await eraseSubject(supabase, tenant_id, { guest_id, phone }, eraseMode);
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Erase failed" }, { status: 400 });
    }
    await logAuditEvent({
      tenant_id,
      action: "dsar_erase",
      entity_id: result.guest_id || guest_id || phone || "unknown",
      source: "staff",
      agent_id: auth.userId,
      details: { mode: eraseMode, affected: result.affected },
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
