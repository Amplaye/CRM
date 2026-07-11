import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { ABSENCE_KINDS, datesInRange, isValidDate, type AbsenceKind } from "@/lib/staff/shift-rules";
import { sendPushToTenant } from "@/lib/push/send";

// Manager-recorded absences (ferie / malattia / imprevisto).
//
// POST   { tenant_id, member_id, reason_kind, work_date, end_date?, reason? }
//   → owner/manager. Records an ALREADY-APPROVED time_off for a member across
//     work_date..end_date (end_date defaults to work_date = single day) and
//     cancels that member's scheduled shifts on every day in the range. This is
//     the "Marco is on holiday next week" / "Ana called in sick" button — the
//     manager decides directly, no waiter self-request needed.
// DELETE { tenant_id, request_id }
//   → owner/manager. Removes an absence record. (Cancelled shifts stay
//     cancelled — the manager re-adds them if the person comes back; we don't
//     silently un-cancel, since the rota may have moved on.)
//
// reason_kind: vacation | sick | personal | other.

const MAX_RANGE_DAYS = 60;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string | undefined = body?.tenant_id;
  const manager = tenantId ? await verifyTenantMembership(tenantId, ["owner", "manager"]) : null;
  if (!manager) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const memberId: string = typeof body?.member_id === "string" ? body.member_id : "";
  if (!memberId) return NextResponse.json({ error: "member_required" }, { status: 400 });

  const reasonKind = body?.reason_kind;
  if (!ABSENCE_KINDS.includes(reasonKind as AbsenceKind)) {
    return NextResponse.json({ error: "invalid_reason_kind" }, { status: 400 });
  }

  const workDate: string = body?.work_date;
  const endDate: string | null = body?.end_date && String(body.end_date).trim() ? body.end_date : null;
  if (!isValidDate(workDate)) return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  if (endDate && !isValidDate(endDate)) return NextResponse.json({ error: "invalid_date" }, { status: 400 });

  const days = datesInRange(workDate, endDate ?? workDate);
  if (days.length === 0) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  if (days.length > MAX_RANGE_DAYS) return NextResponse.json({ error: "range_too_long" }, { status: 400 });

  const svc = createServiceRoleClient();

  // The member must belong to this tenant.
  const { data: target } = await svc
    .from("tenant_members")
    .select("id, user_id")
    .eq("id", memberId)
    .eq("tenant_id", tenantId!)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

  // Record the absence (already decided by this manager).
  const nowIso = new Date().toISOString();
  const { data: absence, error } = await svc
    .from("shift_requests")
    .insert({
      tenant_id: tenantId,
      member_id: memberId,
      type: "time_off",
      reason_kind: reasonKind,
      work_date: workDate,
      end_date: endDate,
      reason: typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 300) : null,
      status: "approved",
      decided_by: manager.userId,
      decided_at: nowIso,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Free those days: cancel the member's scheduled shifts across the range.
  const { data: cancelled } = await svc
    .from("staff_shifts")
    .update({ status: "cancelled", updated_at: nowIso })
    .eq("tenant_id", tenantId!)
    .eq("member_id", memberId)
    .in("work_date", days)
    .eq("status", "scheduled")
    .select("id");

  // Tell the member they've been marked off (best-effort).
  if (target.user_id) {
    void sendPushToTenant(
      tenantId!,
      "shift_request_approved",
      { date: endDate ? `${workDate} → ${endDate}` : workDate },
      { onlyUserId: target.user_id },
    );
  }

  return NextResponse.json({ absence, cancelled_shifts: cancelled?.length ?? 0 });
}

export async function DELETE(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const tenantId: string | undefined = body?.tenant_id;
  const requestId: string | undefined = typeof body?.request_id === "string" ? body.request_id : undefined;
  const manager = tenantId ? await verifyTenantMembership(tenantId, ["owner", "manager"]) : null;
  if (!manager) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!requestId) return NextResponse.json({ error: "request_required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { error } = await svc
    .from("shift_requests")
    .delete()
    .eq("id", requestId)
    .eq("tenant_id", tenantId!)
    .eq("type", "time_off");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
