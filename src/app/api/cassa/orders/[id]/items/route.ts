import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, loadOrder, recomputeOrder } from "@/lib/cassa/server";

// Lines of a bill.
//
// POST  /api/cassa/orders/[id]/items { tenant_id, items: [{ menu_item_id?, name,
//        unit_price, qty, course?, notes?, vat_rate?, station?, variants? }],
//        draft? }
//        → draft:true appends CART lines (status 'draft', comanda_no 0): the
//          shared carrello every device streams over realtime. Without draft
//          it fires the batch immediately as the next comanda round (legacy).
//        unit_price arrives INCLUSIVE of variant deltas; variants[] is the
//        display snapshot for tickets/receipts. vat_rate/station are snapshots
//        of the menu item at fire time.
// PATCH /api/cassa/orders/[id]/items — one of:
//        { action: "cancel", item_id }  → storno of a SENT line: never deleted,
//          flagged cancelled so the kitchen/audit trail stays truthful.
//        { action: "update", item_id, qty?, course?, notes? } → edit a DRAFT.
//        { action: "remove", item_id }  → delete a DRAFT (it never fired).
//        { action: "send" }             → flip ALL drafts → sent as the next
//          comanda round; returns { items, comanda_no, totals }.

const MAX_LINES_PER_COMANDA = 100;
const MAX_VARIANTS_PER_LINE = 10;

/** Sanitize the [{name, price_delta}] snapshot; null = reject the line. */
function parseVariants(raw: unknown): Array<{ name: string; price_delta: number }> | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_VARIANTS_PER_LINE) return null;
  const out: Array<{ name: string; price_delta: number }> = [];
  for (const v of raw) {
    const name = typeof (v as any)?.name === "string" ? (v as any).name.trim().slice(0, 60) : "";
    const delta = Number((v as any)?.price_delta ?? 0);
    if (!name || !Number.isFinite(delta) || Math.abs(delta) > 1000) return null;
    out.push({ name, price_delta: Math.round(delta * 100) / 100 });
  }
  return out;
}

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

  const asDraft = body?.draft === true;
  const comandaNo = asDraft
    ? 0
    : loaded.items.reduce((m, i) => Math.max(m, i.comanda_no), 0) + 1;
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
    const variants = parseVariants(it?.variants);
    if (variants === null) {
      return NextResponse.json({ error: "invalid_items" }, { status: 400 });
    }
    const vatRaw = Number(it?.vat_rate);
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
      vat_rate: Number.isFinite(vatRaw) && vatRaw >= 0 && vatRaw <= 100 ? Math.round(vatRaw * 100) / 100 : null,
      station: typeof it?.station === "string" && it.station.trim() ? it.station.trim().slice(0, 40) : null,
      variants,
      ...(asDraft ? { status: "draft" as const } : {}),
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
  const action = body?.action;
  const needsItem = action === "cancel" || action === "update" || action === "remove";
  if (
    (action !== "cancel" && action !== "update" && action !== "remove" && action !== "send") ||
    (needsItem && typeof body?.item_id !== "string")
  ) {
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

  // ---- send: fire every draft as the next comanda round --------------------
  if (action === "send") {
    const drafts = loaded.items.filter((i) => i.status === "draft");
    if (drafts.length === 0) {
      return NextResponse.json({ items: [], comanda_no: null, totals: await recomputeOrder(svc, loaded.order, loaded.items) });
    }
    const comandaNo = loaded.items.reduce((m, i) => Math.max(m, i.comanda_no), 0) + 1;
    const { data: flipped, error } = await svc
      .from("cassa_order_items")
      .update({ status: "sent", comanda_no: comandaNo })
      .eq("order_id", id)
      .eq("status", "draft")
      .select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const nextItems = loaded.items.map(
      (i) => (flipped || []).find((f: { id: string }) => f.id === i.id) ?? i,
    ) as typeof loaded.items;
    const totals = await recomputeOrder(svc, loaded.order, nextItems);
    return NextResponse.json({ items: flipped, comanda_no: comandaNo, totals });
  }

  const target = loaded.items.find((i) => i.id === body.item_id);
  if (!target) return NextResponse.json({ error: "item_not_found" }, { status: 404 });

  // ---- update / remove: drafts only (sent lines are immutable, storno only) --
  if (action === "update" || action === "remove") {
    if (target.status !== "draft") {
      return NextResponse.json({ error: "not_a_draft" }, { status: 409 });
    }
    if (action === "remove") {
      const { error } = await svc.from("cassa_order_items").delete().eq("id", body.item_id).eq("order_id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const totals = await recomputeOrder(svc, loaded.order, loaded.items.filter((i) => i.id !== body.item_id));
      return NextResponse.json({ ok: true, totals });
    }
    const patch: Record<string, unknown> = {};
    if (body.qty !== undefined) {
      const qty = Number(body.qty);
      if (!Number.isFinite(qty) || qty <= 0 || qty > 999) {
        return NextResponse.json({ error: "invalid_qty" }, { status: 400 });
      }
      patch.qty = Math.round(qty * 100) / 100;
    }
    if (body.course !== undefined) {
      patch.course = Math.min(9, Math.max(1, Math.round(Number(body.course) || 1)));
    }
    if (body.notes !== undefined) {
      patch.notes =
        typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 200) : null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
    }
    const { data: updated, error } = await svc
      .from("cassa_order_items")
      .update(patch)
      .eq("id", body.item_id)
      .eq("order_id", id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const totals = await recomputeOrder(
      svc,
      loaded.order,
      loaded.items.map((i) => (i.id === body.item_id ? (updated as typeof i) : i)),
    );
    return NextResponse.json({ item: updated, totals });
  }

  // ---- cancel (storno) of a sent line ---------------------------------------
  if (target.status === "cancelled") return NextResponse.json({ error: "already_cancelled" }, { status: 409 });
  if (target.status === "draft") return NextResponse.json({ error: "not_sent" }, { status: 409 });

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
