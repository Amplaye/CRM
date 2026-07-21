import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess } from "@/lib/cassa/server";

// POST /api/cassa/orders/[id]/fiscal-doc
//
// Dopo che il browser ha pilotato l'RT (Registratore Telematico) ed emesso il
// documento commerciale, salva l'esito sull'ordine. Il "momento del denaro"
// (fn_cassa_pay_atomic) è già avvenuto: qui NON si registra denaro, si annota
// solo il riferimento fiscale (o lo stato 'pending' se l'RT era irraggiungibile).

const VALID_STATUS = new Set(["emitted", "pending", "skipped"]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const access = await requireCassaAccess(body?.tenant_id);
  if (!isAccess(access)) return access;
  const { svc } = access;

  const status = typeof body?.rt_status === "string" ? body.rt_status : "emitted";
  if (!VALID_STATUS.has(status)) {
    return NextResponse.json({ error: "invalid_rt_status" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    rt_status: status,
    rt_doc_number: typeof body?.rt_doc_number === "string" ? body.rt_doc_number.slice(0, 64) : null,
    rt_serial: typeof body?.rt_serial === "string" ? body.rt_serial.slice(0, 64) : null,
    updated_at: new Date().toISOString(),
  };
  if (body?.rt_doc_date) {
    const d = new Date(body.rt_doc_date);
    patch.rt_doc_date = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } else if (status === "emitted") {
    patch.rt_doc_date = new Date().toISOString();
  }

  const { data: updated, error } = await svc
    .from("cassa_orders")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", body.tenant_id)
    .select("id, rt_status, rt_doc_number, rt_doc_date, rt_serial")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, order: updated });
}
