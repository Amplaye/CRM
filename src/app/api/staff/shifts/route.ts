import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { findConflict, validateShiftInput, type ShiftLike } from "@/lib/staff/shift-rules";
import { sendPushToTenant } from "@/lib/push/send";

// Weekly rota CRUD.
//
// GET    /api/staff/shifts?tenant_id&from=YYYY-MM-DD&to=YYYY-MM-DD
//          → every member's shifts in the window (any team member may read —
//            it's the posted rota).
// POST   { tenant_id, member_id, work_date, band, start_time, end_time, role_note? }
//          → owner/manager. Rejects double-booking the same member/date/hours.
// PATCH  { tenant_id, shift_id, work_date?, band?, start_time?, end_time?, role_note?, member_id?, action?: "cancel" }
//          → owner/manager. Edit or cancel (cancelled rows stay for history).
// DELETE { tenant_id, shift_id } → owner/manager. Hard-remove a mistake.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id") || "";
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if (!tenantId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const member = await verifyTenantMembership(tenantId);
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { data, error } = await svc
    .from("staff_shifts")
    .select("*")
    .eq("tenant_id", tenantId)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date")
    .order("start_time");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shifts: data || [] });
}

async function requireManager(tenantId: string | undefined) {
  if (!tenantId) return null;
  return verifyTenantMembership(tenantId, ["owner", "manager"]);
}

/** Push "new shift" to the member's user (best-effort). */
async function notifyAssignee(
  svc: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  memberId: string,
  shift: { work_date: string; start_time: string; end_time: string },
) {
  const { data: m } = await svc
    .from("tenant_members")
    .select("user_id")
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!m?.user_id) return;
  void sendPushToTenant(
    tenantId,
    "shift_new",
    { date: shift.work_date, start: shift.start_time.slice(0, 5), end: shift.end_time.slice(0, 5) },
    { onlyUserId: m.user_id },
  );
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const tenantId: string | undefined = body?.tenant_id;
  const manager = await requireManager(tenantId);
  if (!manager) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const invalid = validateShiftInput(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  if (!memberId) return NextResponse.json({ error: "member_required" }, { status: 400 });

  const svc = createServiceRoleClient();

  // The member must belong to this tenant.
  const { data: target } = await svc
    .from("tenant_members")
    .select("id")
    .eq("id", memberId)
    .eq("tenant_id", tenantId!)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

  // No double-booking: same member, same date, overlapping hours.
  const { data: sameDay } = await svc
    .from("staff_shifts")
    .select("id, member_id, work_date, start_time, end_time, status")
    .eq("tenant_id", tenantId!)
    .eq("member_id", memberId)
    .eq("work_date", body.work_date);
  const candidate: ShiftLike = {
    member_id: memberId,
    work_date: body.work_date,
    start_time: body.start_time,
    end_time: body.end_time,
  };
  if (findConflict((sameDay || []) as ShiftLike[], candidate)) {
    return NextResponse.json({ error: "shift_conflict" }, { status: 409 });
  }

  const { data: shift, error } = await svc
    .from("staff_shifts")
    .insert({
      tenant_id: tenantId,
      member_id: memberId,
      work_date: body.work_date,
      band: body.band,
      start_time: body.start_time,
      end_time: body.end_time,
      role_note:
        typeof body?.role_note === "string" && body.role_note.trim() ? body.role_note.trim().slice(0, 60) : null,
      created_by: manager.userId,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await notifyAssignee(svc, tenantId!, memberId, shift);
  return NextResponse.json({ shift });
}

export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const tenantId: string | undefined = body?.tenant_id;
  const shiftId: string | undefined = typeof body?.shift_id === "string" ? body.shift_id : undefined;
  const manager = await requireManager(tenantId);
  if (!manager) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!shiftId) return NextResponse.json({ error: "shift_required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { data: existing } = await svc
    .from("staff_shifts")
    .select("*")
    .eq("id", shiftId)
    .eq("tenant_id", tenantId!)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "shift_not_found" }, { status: 404 });

  if (body?.action === "cancel") {
    const { data: shift, error } = await svc
      .from("staff_shifts")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", shiftId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ shift });
  }

  const next = {
    work_date: body.work_date ?? existing.work_date,
    band: body.band ?? existing.band,
    start_time: body.start_time ?? existing.start_time,
    end_time: body.end_time ?? existing.end_time,
    member_id: typeof body.member_id === "string" ? body.member_id : existing.member_id,
  };
  const invalid = validateShiftInput(next);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { data: sameDay } = await svc
    .from("staff_shifts")
    .select("id, member_id, work_date, start_time, end_time, status")
    .eq("tenant_id", tenantId!)
    .eq("member_id", next.member_id)
    .eq("work_date", next.work_date);
  if (
    findConflict((sameDay || []) as ShiftLike[], {
      id: shiftId,
      member_id: next.member_id,
      work_date: next.work_date,
      start_time: next.start_time,
      end_time: next.end_time,
    })
  ) {
    return NextResponse.json({ error: "shift_conflict" }, { status: 409 });
  }

  const { data: shift, error } = await svc
    .from("staff_shifts")
    .update({
      ...next,
      role_note:
        body.role_note !== undefined
          ? typeof body.role_note === "string" && body.role_note.trim()
            ? body.role_note.trim().slice(0, 60)
            : null
          : existing.role_note,
      status: "scheduled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", shiftId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Reassignment / time change → tell the (new) assignee.
  if (next.member_id !== existing.member_id || next.work_date !== existing.work_date || next.start_time !== existing.start_time) {
    await notifyAssignee(svc, tenantId!, next.member_id, shift);
  }
  return NextResponse.json({ shift });
}

export async function DELETE(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const tenantId: string | undefined = body?.tenant_id;
  const shiftId: string | undefined = typeof body?.shift_id === "string" ? body.shift_id : undefined;
  const manager = await requireManager(tenantId);
  if (!manager) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!shiftId) return NextResponse.json({ error: "shift_required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { error } = await svc.from("staff_shifts").delete().eq("id", shiftId).eq("tenant_id", tenantId!);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
