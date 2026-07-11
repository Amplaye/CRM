import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { addDays, findConflict, isValidDate, type ShiftLike } from "@/lib/staff/shift-rules";

// Copy an entire week's rota onto another week.
//
// POST { tenant_id, source_week_start, target_week_start }  (both = a Monday,
//        YYYY-MM-DD)
//   → owner/manager. Recreates every SCHEDULED shift from the source week on
//     the same weekday of the target week. ADD-ONLY: a target cell that already
//     has an overlapping shift is left untouched (so copying twice, or copying
//     onto a partly-filled week, never duplicates). Returns created vs skipped.
//
// The usual accelerator: "same as last week" — one click instead of re-entering
// the whole grid.

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

  const sourceStart: string = body?.source_week_start;
  const targetStart: string = body?.target_week_start;
  if (!isValidDate(sourceStart) || !isValidDate(targetStart)) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  if (sourceStart === targetStart) {
    return NextResponse.json({ error: "same_week" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const sourceEnd = addDays(sourceStart, 6);
  const targetEnd = addDays(targetStart, 6);

  // Source shifts to clone, and existing target shifts to avoid clobbering.
  const [{ data: sourceRows }, { data: targetRows }] = await Promise.all([
    svc
      .from("staff_shifts")
      .select("member_id, work_date, band, start_time, end_time, role_note, status")
      .eq("tenant_id", tenantId!)
      .eq("status", "scheduled")
      .gte("work_date", sourceStart)
      .lte("work_date", sourceEnd),
    svc
      .from("staff_shifts")
      .select("id, member_id, work_date, start_time, end_time, status")
      .eq("tenant_id", tenantId!)
      .gte("work_date", targetStart)
      .lte("work_date", targetEnd),
  ]);

  const source = sourceRows || [];
  if (source.length === 0) return NextResponse.json({ created: 0, skipped: 0, empty: true });

  const existing = (targetRows || []) as ShiftLike[];
  const toInsert: Array<Record<string, unknown>> = [];
  let skipped = 0;

  for (const s of source) {
    // Same weekday, seven (or a multiple) days along: shift by the whole-week delta.
    const target_date = addDays(s.work_date, daysBetween(sourceStart, targetStart));
    const candidate: ShiftLike = {
      member_id: s.member_id,
      work_date: target_date,
      start_time: s.start_time,
      end_time: s.end_time,
    };
    if (findConflict(existing, candidate)) {
      skipped++;
      continue;
    }
    existing.push({ ...candidate, id: `pending-${toInsert.length}`, status: "scheduled" });
    toInsert.push({
      tenant_id: tenantId,
      member_id: s.member_id,
      work_date: target_date,
      band: s.band,
      start_time: s.start_time,
      end_time: s.end_time,
      role_note: s.role_note ?? null,
      created_by: manager.userId,
    });
  }

  let created = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error } = await svc.from("staff_shifts").insert(toInsert).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    created = inserted?.length ?? 0;
  }

  return NextResponse.json({ created, skipped });
}

/** Whole-day delta between two "YYYY-MM-DD" dates (target - source). */
function daysBetween(from: string, to: string): number {
  const p = (d: string) => {
    const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
    return Date.UTC(y, (m || 1) - 1, day || 1);
  };
  return Math.round((p(to) - p(from)) / (24 * 60 * 60 * 1000));
}
