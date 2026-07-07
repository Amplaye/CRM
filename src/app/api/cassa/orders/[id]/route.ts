import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, loadOrder, recomputeOrder } from "@/lib/cassa/server";

// One bill.
//
// GET    /api/cassa/orders/[id]?tenant_id=…   → full order (lines + payments)
// PATCH  /api/cassa/orders/[id]               → covers / discount / notes / move table
// DELETE /api/cassa/orders/[id]?tenant_id=…   → cancel an OPEN bill (nothing was cashed)

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenantId = new URL(req.url).searchParams.get("tenant_id");
  const access = await requireCassaAccess(tenantId);
  if (!isAccess(access)) return access;
  const { svc } = access;

  const { data: order, error } = await svc
    .from("cassa_orders")
    .select("*, items:cassa_order_items(*), payments:cassa_payments(*)")
    .eq("id", id)
    .eq("tenant_id", tenantId!)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  return NextResponse.json({ order });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const patch: Record<string, unknown> = {};
  if (body.covers !== undefined) {
    patch.covers = Math.max(0, Math.min(500, Math.round(Number(body.covers) || 0)));
  }
  if (body.cover_unit !== undefined) {
    // Per-order coperto override: lets the cashier set/correct the cover price on
    // a bill that was opened before the coperto was configured (the snapshot is
    // taken at creation, so an open bill would otherwise stay stuck at 0).
    const cu = Number(body.cover_unit);
    patch.cover_unit = Number.isFinite(cu) && cu >= 0 ? Math.round(cu * 100) / 100 : 0;
  }
  if (body.discount_type !== undefined) {
    // null clears the discount; otherwise type+value arrive together.
    if (body.discount_type === null) {
      patch.discount_type = null;
      patch.discount_value = 0;
    } else if (["percent", "amount"].includes(body.discount_type)) {
      patch.discount_type = body.discount_type;
      patch.discount_value = Math.max(0, Number(body.discount_value) || 0);
    } else {
      return NextResponse.json({ error: "invalid_discount" }, { status: 400 });
    }
  }
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;
  }
  if (body.table_id !== undefined) {
    // Move table (cambio tavolo): refuse if the target already has a live bill.
    const targetId = typeof body.table_id === "string" ? body.table_id : null;
    if (targetId) {
      const { data: busy } = await svc
        .from("cassa_orders")
        .select("id")
        .eq("tenant_id", body.tenant_id)
        .eq("table_id", targetId)
        .eq("status", "open")
        .neq("id", id)
        .limit(1)
        .maybeSingle();
      if (busy) return NextResponse.json({ error: "table_busy" }, { status: 409 });
    }
    patch.table_id = targetId;
    if (typeof body.table_name === "string" && body.table_name) {
      patch.table_name = body.table_name.slice(0, 80);
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const { data: updated, error } = await svc
    .from("cassa_orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totals = await recomputeOrder(svc, updated, loaded.items);
  return NextResponse.json({ order: { ...updated, subtotal: totals.subtotal, total: totals.total }, totals });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const tenantId = new URL(req.url).searchParams.get("tenant_id");
  const access = await requireCassaAccess(tenantId);
  if (!isAccess(access)) return access;
  const { svc } = access;

  // Only an OPEN bill can be cancelled here — nothing was cashed, no receipt
  // exists. Annulling a PAID receipt is the separate, role-gated /void route.
  const { data: cancelled, error } = await svc
    .from("cassa_orders")
    .update({ status: "cancelled", closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId!)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cancelled) return NextResponse.json({ error: "order_not_open" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
