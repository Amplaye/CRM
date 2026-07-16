import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { findConflict, validateShiftInput, type ShiftLike } from "@/lib/staff/shift-rules";
import { sendPushToTenant } from "@/lib/push/send";

// Bulk rota fill — one band/time applied to many members across many dates.
//
// POST { tenant_id, member_ids: string[], dates: string[] (YYYY-MM-DD),
//        band, start_time, end_time, role_note? }
//   → owner/manager. Creates one shift per (member × date) pair, but SKIPS any
//     cell that already has an overlapping shift, so it's idempotent: run it
//     again after adding a person and only the gaps fill in. Returns how many
//     were created vs skipped.
//
// This is the accelerator for "set the whole week for the whole team at once"
// instead of the per-cell modal.

const MAX_MEMBERS = 50;
const MAX_DATES = 62; // up to ~2 months of daily fills in one call
const MAX_PAIRS = 800; // hard backstop on a single insert batch

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

  const memberIds: string[] = Array.isArray(body?.member_ids)
    ? [...new Set<string>(body.member_ids.filter((x: unknown): x is string => typeof x === "string" && !!x))]
    : [];
  const dates: string[] = Array.isArray(body?.dates)
    ? [...new Set<string>(body.dates.filter((x: unknown): x is string => typeof x === "string"))]
    : [];

  if (memberIds.length === 0) return NextResponse.json({ error: "no_members" }, { status: 400 });
  if (dates.length === 0) return NextResponse.json({ error: "no_dates" }, { status: 400 });
  if (memberIds.length > MAX_MEMBERS || dates.length > MAX_DATES) {
    return NextResponse.json({ error: "too_many" }, { status: 400 });
  }

  // Validate the shared band/time once against every date.
  for (const d of dates) {
    const invalid = validateShiftInput({
      work_date: d,
      band: body?.band,
      start_time: body?.start_time,
      end_time: body?.end_time,
    });
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  }
  if (memberIds.length * dates.length > MAX_PAIRS) {
    return NextResponse.json({ error: "too_many" }, { status: 400 });
  }

  const svc = createServiceRoleClient();

  // Keep only member_ids that actually belong to this tenant.
  const { data: valid } = await svc
    .from("tenant_members")
    .select("id")
    .eq("tenant_id", tenantId!)
    .in("id", memberIds);
  const validIds = new Set((valid || []).map((r: any) => r.id as string));
  const targetMembers = memberIds.filter((id) => validIds.has(id));
  if (targetMembers.length === 0) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

  const dateFrom = [...dates].sort()[0];
  const dateTo = [...dates].sort()[dates.length - 1];

  // Pull existing shifts across the whole window/members in one query, then do
  // conflict checks in memory (no per-cell round-trip).
  const { data: existingRows } = await svc
    .from("staff_shifts")
    .select("id, member_id, work_date, start_time, end_time, status")
    .eq("tenant_id", tenantId!)
    .in("member_id", targetMembers)
    .gte("work_date", dateFrom)
    .lte("work_date", dateTo);
  const existing = (existingRows || []) as ShiftLike[];

  const roleNote =
    typeof body?.role_note === "string" && body.role_note.trim() ? body.role_note.trim().slice(0, 60) : null;

  const toInsert: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const memberId of targetMembers) {
    for (const work_date of dates) {
      const candidate: ShiftLike = {
        member_id: memberId,
        work_date,
        start_time: body.start_time,
        end_time: body.end_time,
      };
      if (findConflict(existing, candidate)) {
        skipped++;
        continue;
      }
      // Add to the in-memory set too, so two identical dates in the payload
      // can't self-collide (defensive — dates are de-duped above).
      existing.push({ ...candidate, id: `pending-${toInsert.length}`, status: "scheduled" });
      toInsert.push({
        tenant_id: tenantId,
        member_id: memberId,
        work_date,
        band: body.band,
        start_time: body.start_time,
        end_time: body.end_time,
        role_note: roleNote,
        created_by: manager.userId,
      });
    }
  }

  let created = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error } = await svc.from("staff_shifts").insert(toInsert).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    created = inserted?.length ?? 0;

    // Best-effort: tell each assigned member their rota changed (one push per
    // member, not per shift, to avoid a notification storm). Reuses the
    // shift_new event (routes to /staff) with the earliest affected date.
    const earliest = [...dates].sort()[0];
    const { data: memberRows } = await svc
      .from("tenant_members")
      .select("id, user_id")
      .eq("tenant_id", tenantId!)
      .in("id", targetMembers);
    for (const m of memberRows || []) {
      if ((m as any).user_id) {
        void sendPushToTenant(
          tenantId!,
          "shift_new",
          { date: earliest, start: String(body.start_time).slice(0, 5), end: String(body.end_time).slice(0, 5) },
          { onlyUserId: (m as any).user_id },
        );
      }
    }
  }

  return NextResponse.json({ created, skipped });
}
