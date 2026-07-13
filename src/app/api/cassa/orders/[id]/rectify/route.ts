import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, loadOrder, getCassaSettings } from "@/lib/cassa/server";
import { businessDateOf, isActiveLine } from "@/lib/cassa/totals";
import { quoteRefund, type RefundSelection } from "@/lib/cassa/refund";
import { logAuditEvent } from "@/lib/audit";
import { logSystemEvent } from "@/lib/system-log";
import { getFiscalContext, assertFiscal, fiscalNow, toDesglose } from "@/lib/fiscal/server";
import { flushSubmission } from "@/lib/fiscal/queue";

// Reso parziale — la rettificativa R5. Owner/manager soltanto.
//
// POST /api/cassa/orders/[id]/rectify
//   { tenant_id, reason, lines: [{ line_id, qty }] }
//
// Finora la cassa sapeva correggere un incasso in un modo solo: annullarlo tutto.
// Ma il caso vero al banco è il reso parziale — cinque birre pagate, due sbagliate,
// si rendono quelle. Annullare l'intero scontrino per rendere 9 € su 36 cancella un
// incasso che è realmente avvenuto: contabilmente è una bugia, e sotto un registro
// fiscale è esattamente l'atto che il registro esiste per impedire.
//
// La forma giusta è un documento NUOVO: una fattura rettificativa (tipo R5) con un
// proprio numero, che entra in catena e PUNTA all'originale. L'originale non si
// tocca — resta valido e immutabile dov'è.
//
// Gli importi si calcolano server-side (quoteRefund), mai dal client: la matematica
// del reso è la stessa dell'incasso, e sotto VeriFactu il desglose che ne esce viene
// registrato in AEAT alla lettera.
//
// Come per pay/void, il record fiscale sta DENTRO la transazione: se AEAT non può
// registrare il reso, il reso non è avvenuto. Un cassiere che riprova è recuperabile;
// un rimborso senza registro no.

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

  const selection: RefundSelection[] = Array.isArray(body?.lines)
    ? body.lines
        .map((l: any) => ({ line_id: String(l?.line_id ?? ""), qty: Math.max(0, Math.floor(Number(l?.qty) || 0)) }))
        .filter((l: RefundSelection) => l.line_id && l.qty > 0)
    : [];
  if (selection.length === 0) return NextResponse.json({ error: "no_lines" }, { status: 400 });

  const access = await requireCassaAccess(tenantId, ["owner", "manager"]);
  if (!isAccess(access)) return access;
  const { svc, userId } = access;

  // Stessa guardia di pay/void: una cassa che non è il SIF dichiarato per il suo NIF
  // non può emettere documenti fiscali — e una rettificativa È un documento fiscale.
  const fiscal = await getFiscalContext(svc, tenantId!);
  const denied = assertFiscal(fiscal);
  if (denied) return denied;

  const loaded = await loadOrder(svc, id);
  if (!loaded || loaded.order.tenant_id !== tenantId) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  const { order, items } = loaded;
  if (order.status !== "paid") return NextResponse.json({ error: "order_not_paid" }, { status: 409 });

  const now = new Date();
  const nowIso = now.toISOString();
  const { timezone } = await getCassaSettings(svc, tenantId!);
  const businessDate = businessDateOf(timezone);
  const receiptYear = Number(businessDate.slice(0, 4));

  // Il delta, calcolato dalle righe memorizzate: negativo, sconto già dedotto,
  // IVA già ripartita per aliquota.
  const quote = quoteRefund(order, items.filter(isActiveLine), selection, fiscal.vat);
  if (quote.importeTotal >= 0 || quote.lines.length === 0) {
    return NextResponse.json({ error: "nothing_to_refund" }, { status: 400 });
  }

  const { data: result, error: rectErr } = await svc.rpc("fn_cassa_rectify_atomic", {
    p_tenant_id: tenantId,
    p_order_id: id,
    p_reason: reason,
    p_rectified_by: userId,
    p_business_date: businessDate,
    p_year: receiptYear,
    p_closed_at: nowIso,
    p_net_total: quote.netTotal,
    p_cuota_total: quote.cuotaTotal,
    p_importe_total: quote.importeTotal,
    p_desglose: toDesglose(fiscal, quote.rows),
    p_fiscal: fiscal.register,
    p_obligado_id: fiscal.obligadoId,
    p_serie: fiscal.serie,
    p_fecha_hora_huso: fiscal.register ? fiscalNow(fiscal, now) : null,
    p_sistema: fiscal.sistema,
  });

  if (rectErr) {
    await logSystemEvent({
      tenant_id: tenantId,
      category: "api_error",
      severity: "critical",
      title: "Cassa: rettificativa rifiutata",
      description: `Ordine ${id} NON rettificato (transazione annullata): ${rectErr.message}`,
    });
    // Il superamento del residuo è un errore d'uso, non un guasto: va detto al
    // cassiere, non nascosto dietro un 500.
    const overRefund = /oltre il residuo|importo negativo/.test(rectErr.message);
    return NextResponse.json(
      { error: overRefund ? "refund_exceeds_total" : "rectify_failed", detail: rectErr.message },
      { status: overRefund ? 409 : 500 },
    );
  }
  if (!result?.rectified) return NextResponse.json({ error: "order_not_paid" }, { status: 409 });

  const fiscalRecordId: string | null = result.fiscal_record_id ?? null;

  // Il magazzino: le porzioni rese tornano disponibili. Stessa funzione della
  // consumazione, con quantità negativa — un movimento compensativo visibile, come
  // per l'annullo. Best-effort: un errore qui non deve annullare un reso avvenuto.
  for (const sel of quote.lines) {
    const item = items.find((i) => i.id === sel.line_id);
    if (!item?.menu_item_id) continue;
    try {
      const { error: rpcErr } = await svc.rpc("fn_consume_stock_for_sale_item", {
        p_tenant_id: tenantId,
        p_menu_item_id: item.menu_item_id,
        p_sold_qty: -sel.qty,
      });
      if (rpcErr) throw new Error(rpcErr.message);
    } catch (err) {
      await logSystemEvent({
        tenant_id: tenantId,
        category: "api_error",
        severity: "medium",
        title: "Cassa: reintegro magazzino fallito su rettificativa",
        description: `Riga "${item.name}" ×${sel.qty} (ordine ${id}): ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Spinta immediata ad AEAT; se la rete è giù la coda ci riproverà.
  if (fiscalRecordId) {
    await flushSubmission(svc, fiscalRecordId).catch(() => {});
  }

  await logAuditEvent({
    tenant_id: tenantId!,
    action: "cassa.rectify",
    entity_id: id,
    source: "staff",
    details: {
      receipt_number: order.receipt_number,
      receipt_year: order.receipt_year,
      reason,
      refunded: -quote.importeTotal,
      refunded_total: result.refunded_total ?? null,
      lines: quote.lines,
      num_serie: result.num_serie ?? null,
      rectifies_num_serie: result.rectifies_num_serie ?? null,
      fiscal_record_id: fiscalRecordId,
    },
  });

  return NextResponse.json({
    ok: true,
    num_serie: result.num_serie ?? null,
    receipt_number: result.receipt_number ?? null,
    refunded: -quote.importeTotal,
    refunded_total: result.refunded_total ?? null,
    lines: quote.lines,
    fiscal_record_id: fiscalRecordId,
  });
}
