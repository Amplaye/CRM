import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, loadOrder, getCassaSettings } from "@/lib/cassa/server";
import { isActiveLine, businessDateOf } from "@/lib/cassa/totals";
import { logAuditEvent } from "@/lib/audit";
import { logSystemEvent } from "@/lib/system-log";
import { getFiscalContext, assertFiscal, fiscalNow } from "@/lib/fiscal/server";
import { flushSubmission } from "@/lib/fiscal/queue";

// Annullo scontrino — owner/manager only.
//
// POST /api/cassa/orders/[id]/void { tenant_id, reason }
//
// The receipt is never deleted: it flips paid → void and keeps its number, so the
// daily journal shows the annulment honestly.
//
// What CHANGED, and why it had to: this route used to `DELETE FROM pos_sales` —
// it physically erased a sale that had already been cashed. Convenient for the P&L,
// and precisely the act a fiscal register exists to make impossible. Now:
//
//   • pos_sales gets a COMPENSATING NEGATIVE ROW instead of losing its original.
//     The analytics come out identical (the pair sums to zero) and nothing is gone.
//   • Spain additionally chains a RegistroAnulacion — an immutable record that says
//     "the invoice I name here never happened" — and queues it for AEAT.
//
// The recipe stock depleted at payment is still put back with the same ledger
// function called with a negative quantity: a visible compensating movement, which
// is the same principle, applied to the warehouse.

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

  const fiscal = await getFiscalContext(svc, tenantId!);
  const denied = assertFiscal(fiscal);
  if (denied) return denied;

  const loaded = await loadOrder(svc, id);
  if (!loaded || loaded.order.tenant_id !== tenantId) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const { timezone } = await getCassaSettings(svc, tenantId!);
  const businessDate = businessDateOf(timezone);

  const { data: result, error: voidErr } = await svc.rpc("fn_cassa_void_atomic", {
    p_tenant_id: tenantId,
    p_order_id: id,
    p_reason: reason,
    p_voided_by: userId,
    p_business_date: businessDate,
    p_closed_at: nowIso,
    p_fiscal: fiscal.register,
    p_obligado_id: fiscal.obligadoId,
    p_fecha_hora_huso: fiscal.register ? fiscalNow(fiscal, now) : null,
    p_sistema: fiscal.sistema,
  });
  if (voidErr) {
    await logSystemEvent({
      tenant_id: tenantId,
      category: "api_error",
      severity: "critical",
      title: "Cassa: annullo rifiutato",
      description: `Ordine ${id} NON annullato (transazione annullata): ${voidErr.message}`,
    });
    return NextResponse.json({ error: "void_failed", detail: voidErr.message }, { status: 500 });
  }
  if (!result?.voided) return NextResponse.json({ error: "order_not_paid" }, { status: 409 });

  const fiscalRecordId: string | null = result.fiscal_record_id ?? null;

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

  if (fiscalRecordId) {
    await flushSubmission(svc, fiscalRecordId).catch(() => {});
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
      num_serie: result.num_serie ?? null,
      fiscal_record_id: fiscalRecordId,
    },
  });

  return NextResponse.json({ ok: true, fiscal_record_id: fiscalRecordId });
}
