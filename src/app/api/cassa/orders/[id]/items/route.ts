import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, loadOrder, recomputeOrder } from "@/lib/cassa/server";

// Lines of a bill.
//
// POST  /api/cassa/orders/[id]/items { tenant_id, items: [{ menu_item_id?, name,
//        unit_price, qty, course?, notes? }] }
//        → fire a comanda: append the batch as the next firing round.
// PATCH /api/cassa/orders/[id]/items { tenant_id, item_id, action: "cancel" }
//        → storno riga: a sent line is never deleted, it's flagged cancelled
//          so the kitchen/audit trail stays truthful.

const MAX_LINES_PER_COMANDA = 100;

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

  const loaded = await loadOrder(svc, id);
  if (!loaded || loaded.order.tenant_id !== body.tenant_id) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (loaded.order.status !== "open") {
    return NextResponse.json({ error: "order_not_open" }, { status: 409 });
  }

  const raw: any[] = Array.isArray(body?.items) ? body.items : [];
  if (raw.length === 0 || raw.length > MAX_LINES_PER_COMANDA) {
    return NextResponse.json({ error: "invalid_items" }, { status: 400 });
  }

  const comandaNo = loaded.items.reduce((m, i) => Math.max(m, i.comanda_no), 0) + 1;
  const rows = [];
  for (const it of raw) {
    const name = typeof it?.name === "string" ? it.name.trim().slice(0, 120) : "";
    const unitPrice = Number(it?.unit_price);
    const qty = Number(it?.qty);
    if (!name || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: "invalid_items" }, { status: 400 });
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty > 999) {
      return NextResponse.json({ error: "invalid_items" }, { status: 400 });
    }
    rows.push({
      tenant_id: body.tenant_id,
      order_id: id,
      menu_item_id: typeof it?.menu_item_id === "string" ? it.menu_item_id : null,
      name,
      unit_price: Math.round(unitPrice * 100) / 100,
      qty: Math.round(qty * 100) / 100,
      course: Math.min(9, Math.max(1, Math.round(Number(it?.course) || 1))),
      comanda_no: comandaNo,
      notes: typeof it?.notes === "string" && it.notes.trim() ? it.notes.trim().slice(0, 200) : null,
    });
  }

  const { data: inserted, error } = await svc.from("cassa_order_items").insert(rows).select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const allItems = [...loaded.items, ...((inserted || []) as typeof loaded.items)];
  const totals = await recomputeOrder(svc, loaded.order, allItems);

  return NextResponse.json({ items: inserted, comanda_no: comandaNo, totals });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (body?.action !== "cancel" || typeof body?.item_id !== "string") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const access = await requireCassaAccess(body?.tenant_id);
  if (!isAccess(access)) return access;
  const { svc } = access;

  const loaded = await loadOrder(svc, id);
  if (!loaded || loaded.order.tenant_id !== body.tenant_id) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (loaded.order.status !== "open") {
    return NextResponse.json({ error: "order_not_open" }, { status: 409 });
  }

  const target = loaded.items.find((i) => i.id === body.item_id);
  if (!target) return NextResponse.json({ error: "item_not_found" }, { status: 404 });
  if (target.status === "cancelled") return NextResponse.json({ error: "already_cancelled" }, { status: 409 });

  const { error } = await svc
    .from("cassa_order_items")
    .update({ status: "cancelled" })
    .eq("id", body.item_id)
    .eq("order_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totals = await recomputeOrder(
    svc,
    loaded.order,
    loaded.items.map((i) => (i.id === body.item_id ? { ...i, status: "cancelled" as const } : i)),
  );
  return NextResponse.json({ ok: true, totals });
}
