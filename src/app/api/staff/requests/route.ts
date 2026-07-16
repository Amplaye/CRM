import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { isValidDate } from "@/lib/staff/shift-rules";
import { sendPushToTenant } from "@/lib/push/send";

// Staff requests: time off, or handing a shift to a colleague (swap).
//
// GET   /api/staff/requests?tenant_id → the tenant's requests (whole team reads;
//         a swap names a colleague, and small teams post the rota openly).
// POST  { tenant_id, type: "time_off"|"swap", work_date, reason?,
//         target_shift_id?, target_member_id? }
//         → any member, always for THEMSELVES. Swap requires their own shift +
//           the colleague who takes it. Managers get a push.
// PATCH { tenant_id, request_id, action: "approve"|"reject" } → owner/manager.
//         Approving a time_off cancels the member's shifts on that date;
//         approving a swap reassigns the shift. Requester gets a push.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const member = await verifyTenantMembership(tenantId);
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { data, error } = await svc
    .from("shift_requests")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data || [] });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const tenantId: string | undefined = body?.tenant_id;
  if (!tenantId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const member = await verifyTenantMembership(tenantId);
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const type = body?.type;
  if (type !== "time_off" && type !== "swap") {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  if (!isValidDate(body?.work_date)) return NextResponse.json({ error: "invalid_date" }, { status: 400 });

  const svc = createServiceRoleClient();

  // The request is always FOR the caller's own membership row.
  const { data: ownMembership } = await svc
    .from("tenant_members")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", member.userId)
    .maybeSingle();
  if (!ownMembership) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let targetShiftId: string | null = null;
  let targetMemberId: string | null = null;
  if (type === "swap") {
    targetShiftId = typeof body?.target_shift_id === "string" ? body.target_shift_id : null;
    targetMemberId = typeof body?.target_member_id === "string" ? body.target_member_id : null;
    if (!targetShiftId || !targetMemberId) {
      return NextResponse.json({ error: "swap_needs_shift_and_member" }, { status: 400 });
    }
    // The shift must be the requester's own, scheduled, in this tenant; the
    // colleague must be a member of the tenant.
    const [{ data: shift }, { data: colleague }] = await Promise.all([
      svc
        .from("staff_shifts")
        .select("id, member_id, status")
        .eq("id", targetShiftId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      svc
        .from("tenant_members")
        .select("id")
        .eq("id", targetMemberId)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
    if (!shift || shift.member_id !== ownMembership.id || shift.status !== "scheduled") {
      return NextResponse.json({ error: "shift_not_yours" }, { status: 400 });
    }
    if (!colleague || colleague.id === ownMembership.id) {
      return NextResponse.json({ error: "invalid_colleague" }, { status: 400 });
    }
  }

  const { data: request, error } = await svc
    .from("shift_requests")
    .insert({
      tenant_id: tenantId,
      member_id: ownMembership.id,
      type,
      work_date: body.work_date,
      target_shift_id: targetShiftId,
      target_member_id: targetMemberId,
      reason: typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 300) : null,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Tell the deciders (owner + managers), not the whole team.
  const { data: requester } = await svc.from("users").select("name").eq("id", member.userId).maybeSingle();
  void sendPushToTenant(
    tenantId,
    "shift_request_new",
    { name: requester?.name || "Staff", date: body.work_date },
    { roles: ["owner", "manager"], excludeUserId: member.userId },
  );

  return NextResponse.json({ request });
}

export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const tenantId: string | undefined = body?.tenant_id;
  const requestId: string | undefined = typeof body?.request_id === "string" ? body.request_id : undefined;
  const action = body?.action;
  if (!tenantId || !requestId || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const manager = await verifyTenantMembership(tenantId, ["owner", "manager"]);
  if (!manager) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { data: request } = await svc
    .from("shift_requests")
    .select("*")
    .eq("id", requestId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!request) return NextResponse.json({ error: "request_not_found" }, { status: 404 });
  if (request.status !== "pending") return NextResponse.json({ error: "already_decided" }, { status: 409 });

  if (action === "approve") {
    if (request.type === "time_off") {
      // Free the day: cancel the member's scheduled shifts on that date.
      await svc
        .from("staff_shifts")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("member_id", request.member_id)
        .eq("work_date", request.work_date)
        .eq("status", "scheduled");
    } else if (request.type === "swap" && request.target_shift_id && request.target_member_id) {
      await svc
        .from("staff_shifts")
        .update({ member_id: request.target_member_id, updated_at: new Date().toISOString() })
        .eq("id", request.target_shift_id)
        .eq("tenant_id", tenantId);
    }
  }

  const { data: decided, error } = await svc
    .from("shift_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      decided_by: manager.userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Tell the requester (and, on an approved swap, the colleague who now works it).
  const { data: reqMember } = await svc
    .from("tenant_members")
    .select("user_id")
    .eq("id", request.member_id)
    .maybeSingle();
  if (reqMember?.user_id) {
    void sendPushToTenant(
      tenantId,
      action === "approve" ? "shift_request_approved" : "shift_request_rejected",
      { date: request.work_date },
      { onlyUserId: reqMember.user_id },
    );
  }
  if (action === "approve" && request.type === "swap" && request.target_member_id) {
    const { data: colleague } = await svc
      .from("tenant_members")
      .select("user_id")
      .eq("id", request.target_member_id)
      .maybeSingle();
    const { data: shift } = request.target_shift_id
      ? await svc.from("staff_shifts").select("work_date, start_time, end_time").eq("id", request.target_shift_id).maybeSingle()
      : { data: null };
    if (colleague?.user_id && shift) {
      void sendPushToTenant(
        tenantId,
        "shift_new",
        { date: shift.work_date, start: String(shift.start_time).slice(0, 5), end: String(shift.end_time).slice(0, 5) },
        { onlyUserId: colleague.user_id },
      );
    }
  }

  return NextResponse.json({ request: decided });
}
