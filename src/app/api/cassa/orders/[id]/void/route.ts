import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, loadOrder } from "@/lib/cassa/server";
import { isActiveLine } from "@/lib/cassa/totals";
import { logAuditEvent } from "@/lib/audit";
import { logSystemEvent } from "@/lib/system-log";

// Annullo scontrino — owner/manager only.
//
// POST /api/cassa/orders/[id]/void { tenant_id, reason }
//
// The receipt is never deleted: it flips paid → void and keeps its number, so
// the daily journal shows the annulment honestly. The canonical pos_sales row
// is removed (P&L/food-cost must not count it) and the recipe stock that was
// depleted at payment is put back with the same ledger function, called with a
// negative quantity — a visible compensating movement, not a silent edit.

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string | undefined = body?.tenant_id;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (!reason) return NextResponse.json({ error: "reason_required" }, { status: 400 });

  const access = await requireCassaAccess(tenantId, ["owner", "manager"]);
  if (!isAccess(access)) return access;
  const { svc, userId } = access;

  const loaded = await loadOrder(svc, id);
  if (!loaded || loaded.order.tenant_id !== tenantId) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { data: voided, error: voidErr } = await svc
    .from("cassa_orders")
    .update({ status: "void", void_reason: reason, voided_at: nowIso, voided_by: userId, updated_at: nowIso })
    .eq("id", id)
    .eq("status", "paid")
    .select("id")
    .maybeSingle();
  if (voidErr) return NextResponse.json({ error: voidErr.message }, { status: 500 });
  if (!voided) return NextResponse.json({ error: "order_not_paid" }, { status: 409 });

  // Remove the canonical sale (pos_sale_items cascade with it).
  const { error: saleErr } = await svc
    .from("pos_sales")
    .delete()
    .eq("tenant_id", tenantId!)
    .eq("provider", "cassa")
    .eq("external_id", id);
  if (saleErr) {
    await logSystemEvent({
      tenant_id: tenantId,
      category: "api_error",
      severity: "high",
      title: "Cassa: annullo senza rimozione da pos_sales",
      description: `Scontrino ${loaded.order.receipt_number ?? id} annullato ma la vendita canonica è rimasta: ${saleErr.message}`,
    });
  }

  // Put the recipe stock back: the same depletion function with −qty writes the
  // opposite ledger movement.
  for (const item of loaded.items.filter(isActiveLine)) {
    if (!item.menu_item_id) continue;
    try {
      const { error: rpcErr } = await svc.rpc("fn_consume_stock_for_sale_item", {
        p_tenant_id: tenantId,
        p_menu_item_id: item.menu_item_id,
        p_sold_qty: -item.qty,
      });
      if (rpcErr) throw new Error(rpcErr.message);
    } catch (err) {
      await logSystemEvent({
        tenant_id: tenantId,
        category: "api_error",
        severity: "medium",
        title: "Cassa: reintegro magazzino fallito su annullo",
        description: `Riga "${item.name}" ×${item.qty} (ordine ${id}): ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  await logAuditEvent({
    tenant_id: tenantId!,
    action: "cassa.void",
    entity_id: id,
    source: "staff",
    details: {
      receipt_number: loaded.order.receipt_number,
      receipt_year: loaded.order.receipt_year,
      total: loaded.order.total,
      reason,
    },
  });

  return NextResponse.json({ ok: true });
}
