import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { isValidDate } from "@/lib/staff/shift-rules";

// Cost the planned rota and write it into labor_cost (which the P&L reads).
//
// POST { tenant_id, from, to }  (from/to = YYYY-MM-DD)
//   → owner/manager. For every SCHEDULED shift in the range, hours × the
//     member's hourly_rate is summed per (work_date, band) and upserted into
//     labor_cost with source='shifts'. Rows the owner typed by hand
//     (source='manual') are LEFT ALONE — a manual figure always wins over the
//     derived one for that (date, band).
//
// This is what turns the P&L's labor line from "always empty because nobody
// fills the manual table" into a real number that tracks the rota.

// "HH:MM[:SS]" → hours since midnight. Overnight shifts (end ≤ start) roll +24h.
function shiftHours(start: string, end: string): number {
  const toH = (t: string) => {
    const [h, m] = t.split(":").map((n) => parseInt(n, 10));
    return (h || 0) + (m || 0) / 60;
  };
  let h = toH(end) - toH(start);
  if (h <= 0) h += 24;
  return Math.round(h * 100) / 100;
}

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

  const from: string = body?.from;
  const to: string = body?.to;
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const [{ data: shiftRows }, { data: memberRows }, { data: existing }] = await Promise.all([
    svc
      .from("staff_shifts")
      .select("member_id, work_date, band, start_time, end_time")
      .eq("tenant_id", tenantId!)
      .eq("status", "scheduled")
      .gte("work_date", from)
      .lte("work_date", to),
    svc.from("staff_pay").select("member_id, hourly_rate").eq("tenant_id", tenantId!),
    svc.from("labor_cost").select("work_date, shift, source").eq("tenant_id", tenantId!).gte("work_date", from).lte("work_date", to),
  ]);

  const rateOf = new Map<string, number>();
  for (const m of memberRows || []) rateOf.set(m.member_id as string, m.hourly_rate == null ? 0 : Number(m.hourly_rate));

  // Aggregate per (work_date, band).
  type Agg = { cost: number; hours: number; members: Set<string> };
  const byKey = new Map<string, Agg>();
  for (const s of shiftRows || []) {
    const key = `${s.work_date}|${s.band}`;
    const agg = byKey.get(key) || { cost: 0, hours: 0, members: new Set<string>() };
    const hours = shiftHours(s.start_time, s.end_time);
    agg.hours += hours;
    agg.cost += hours * (rateOf.get(s.member_id as string) ?? 0);
    agg.members.add(s.member_id as string);
    byKey.set(key, agg);
  }

  // Manual rows win: never overwrite a hand-typed (date, band).
  const manualKeys = new Set(
    (existing || []).filter((r: any) => r.source === "manual").map((r: any) => `${r.work_date}|${r.shift}`),
  );

  // Clear the shifts-owned rows in range, then rewrite from scratch (so removed
  // shifts don't leave a stale cost behind).
  await svc.from("labor_cost").delete().eq("tenant_id", tenantId!).eq("source", "shifts").gte("work_date", from).lte("work_date", to);

  const rows = [...byKey.entries()]
    .filter(([key]) => !manualKeys.has(key))
    .map(([key, agg]) => {
      const [work_date, shift] = key.split("|");
      return {
        tenant_id: tenantId,
        work_date,
        shift,
        cost: Math.round(agg.cost * 100) / 100,
        hours: Math.round(agg.hours * 100) / 100,
        staff_count: agg.members.size,
        source: "shifts",
        notes: "auto: turni",
      };
    });

  let written = 0;
  if (rows.length > 0) {
    const { data, error } = await svc
      .from("labor_cost")
      .upsert(rows, { onConflict: "tenant_id,work_date,shift" })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    written = data?.length ?? 0;
  }

  return NextResponse.json({ ok: true, written, skipped_manual: manualKeys.size, from, to });
}
