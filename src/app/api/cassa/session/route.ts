import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, getCassaSettings } from "@/lib/cassa/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sessionSummary, businessDateOf, toCents, fromCents } from "@/lib/cassa/totals";
import { logAuditEvent } from "@/lib/audit";

// The daily cash session (giornata di cassa).
//
// GET   /api/cassa/session?tenant_id=…   → the open session + its live summary
// POST  /api/cassa/session                { tenant_id, opening_float }  → open
// PATCH /api/cassa/session                { tenant_id, counted_cash?, notes? }
//                                          → close (owner/manager), freezing the summary

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

async function summarize(svc: ServiceClient, sessionId: string, openingFloat: number) {
  const { data: receipts } = await svc
    .from("cassa_orders")
    .select("status, total, covers, cover_unit, subtotal, payments:cassa_payments(method, amount)")
    .eq("session_id", sessionId)
    .in("status", ["paid", "void"]);
  const rows = (receipts || []).map((r: any) => {
    // Recover the discount € from the stored facts:
    // discount = subtotal + coperto − total (all snapshotted at payment).
    const coverC = Math.max(0, Math.round(Number(r.covers) || 0)) * Math.max(0, toCents(r.cover_unit));
    const discountC = Math.max(0, toCents(r.subtotal) + coverC - toCents(r.total));
    return {
      status: r.status as string,
      total: Number(r.total) || 0,
      covers: r.covers as number | null,
      discount_amount: fromCents(discountC),
      payments: (r.payments || []).map((p: any) => ({ method: p.method as string, amount: Number(p.amount) || 0 })),
    };
  });
  return sessionSummary(rows, openingFloat);
}

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant_id");
  const access = await requireCassaAccess(tenantId);
  if (!isAccess(access)) return access;
  const { svc } = access;

  const { data: session } = await svc
    .from("cassa_sessions")
    .select("*")
    .eq("tenant_id", tenantId!)
    .eq("status", "open")
    .maybeSingle();

  const { coverCharge, timezone } = await getCassaSettings(svc, tenantId!);
  const businessDate = businessDateOf(timezone);

  if (!session) {
    // With the register closed the UI shows the last closing report, so the
    // manager sees yesterday's numbers before opening a new day.
    const { data: lastSession } = await svc
      .from("cassa_sessions")
      .select("*")
      .eq("tenant_id", tenantId!)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json({
      session: null,
      summary: null,
      last_session: lastSession ?? null,
      cover_charge: coverCharge,
      business_date: businessDate,
    });
  }

  const summary = await summarize(svc, session.id, Number(session.opening_float) || 0);
  return NextResponse.json({ session, summary, last_session: null, cover_charge: coverCharge, business_date: businessDate });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const access = await requireCassaAccess(body?.tenant_id);
  if (!isAccess(access)) return access;
  const { svc, userId } = access;

  const openingFloat = Math.max(0, Math.min(100000, Number(body?.opening_float) || 0));

  const { data: existing } = await svc
    .from("cassa_sessions")
    .select("*")
    .eq("tenant_id", body.tenant_id)
    .eq("status", "open")
    .maybeSingle();
  if (existing) return NextResponse.json({ session: existing, existing: true });

  const { data: profile } = await svc.from("users").select("name").eq("id", userId).maybeSingle();
  const { data: session, error } = await svc
    .from("cassa_sessions")
    .insert({
      tenant_id: body.tenant_id,
      opening_float: Math.round(openingFloat * 100) / 100,
      opened_by: userId,
      opened_by_name: profile?.name || null,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ session, existing: false });
}

export async function PATCH(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  // Closing the day (and owning the cash difference) is a manager decision.
  const access = await requireCassaAccess(body?.tenant_id, ["owner", "manager"]);
  if (!isAccess(access)) return access;
  const { svc, userId } = access;

  const { data: session } = await svc
    .from("cassa_sessions")
    .select("*")
    .eq("tenant_id", body.tenant_id)
    .eq("status", "open")
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "no_open_session" }, { status: 404 });

  const summary = await summarize(svc, session.id, Number(session.opening_float) || 0);
  const counted =
    body?.counted_cash != null && Number.isFinite(Number(body.counted_cash))
      ? Math.round(Number(body.counted_cash) * 100) / 100
      : null;

  const nowIso = new Date().toISOString();
  const { data: closed, error } = await svc
    .from("cassa_sessions")
    .update({
      status: "closed",
      closed_at: nowIso,
      closed_by: userId,
      expected_cash: summary.expectedCash,
      counted_cash: counted,
      cash_difference: counted != null ? fromCents(toCents(counted) - toCents(summary.expectedCash)) : null,
      totals: summary as unknown as Record<string, unknown>,
      notes: typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null,
    })
    .eq("id", session.id)
    .eq("status", "open")
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!closed) return NextResponse.json({ error: "no_open_session" }, { status: 409 });

  await logAuditEvent({
    tenant_id: body.tenant_id,
    action: "cassa.close_session",
    entity_id: session.id,
    source: "staff",
    details: {
      gross: summary.gross,
      receipts: summary.receipts,
      expected_cash: summary.expectedCash,
      counted_cash: counted,
      difference: closed.cash_difference,
    },
  });

  return NextResponse.json({ session: closed, summary });
}
