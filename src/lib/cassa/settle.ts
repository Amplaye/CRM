// Settle a bill paid ONLINE by the guest (pay-at-table QR) — the guest-side
// sibling of /api/cassa/orders/[id]/pay. Same money moment, same guarantees:
//
//   1. fiscal guard (a till that may not issue tickets takes no money);
//   2. drafts flip to sent (a paid order never keeps "unfired" lines);
//   3. totals/VAT recomputed server-side from the stored lines;
//   4. ONE transaction — fn_cassa_pay_atomic — claims the bill, mints the
//      receipt number, writes pos_sales and (Spain) chains the fiscal record;
//   5. best-effort: cassa_payments row (method 'online'), pos_sale_items
//      mirror, stock depletion, immediate AEAT flush.
//
// Differences from the staff route, all deliberate:
//   • the payment is ALWAYS one 'online' row for the full server total — the
//     caller (public confirm) has already verified against Stripe that exactly
//     that amount was captured;
//   • no gift cards, no cash change;
//   • the cassa session must ALREADY be open (checkout refused to start
//     otherwise); a guest's phone never opens a cash session.
//
// Kept separate from the staff route on purpose: that file is fiscal-critical
// and battle-tested — sharing internals to save ~100 lines would put every till
// payment at risk each time the QR flow changes.

import {
  computeTotals,
  vatBreakdown,
  toCents,
  fromCents,
  businessDateOf,
  isActiveLine,
} from "@/lib/cassa/totals";
import { getCassaSettings } from "@/lib/cassa/server";
import { getFiscalContext, assertFiscal, fiscalNow, toDesglose } from "@/lib/fiscal/server";
import { flushSubmission } from "@/lib/fiscal/queue";
import { logAuditEvent } from "@/lib/audit";
import { logSystemEvent } from "@/lib/system-log";
import type { CassaOrderRow, CassaOrderItemRow } from "@/lib/cassa/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any; // service-role client (called from public routes, no user session)

export type SettleOnlineResult =
  | {
      ok: true;
      receiptNumber: number | null;
      receiptYear: number;
      total: number;
      fiscal: { num_serie: string; huella: string; nif: string | null; fecha: string; importe: number } | null;
    }
  | { ok: false; error: "fiscal_denied" | "order_not_open" | "cassa_closed" | "empty_order" | "pay_failed" };

/** Close an open order as fully paid online. The caller has ALREADY verified
 * (against Stripe, with the tenant's own key) that `expectedTotalCents` was
 * captured; this function re-derives the total one last time and refuses when
 * it no longer matches — money verified against a stale bill must never close
 * a different one. */
export async function settleOrderPaidOnline(
  svc: Svc,
  params: {
    tenantId: string;
    order: CassaOrderRow;
    items: CassaOrderItemRow[];
    expectedTotalCents: number;
  },
): Promise<SettleOnlineResult | { ok: false; error: "amount_mismatch"; expectedCents: number; currentCents: number }> {
  const { tenantId, order } = params;
  let items = params.items;

  const fiscal = await getFiscalContext(svc, tenantId);
  if (assertFiscal(fiscal)) return { ok: false, error: "fiscal_denied" };

  if (order.status !== "open") return { ok: false, error: "order_not_open" };

  const { data: session } = await svc
    .from("cassa_sessions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .maybeSingle();
  if (!session) return { ok: false, error: "cassa_closed" };

  // Drafts go out WITH the bill (same rule as the till).
  if (items.some((i: CassaOrderItemRow) => i.status === "draft")) {
    const comandaNo = items.reduce((m: number, i: CassaOrderItemRow) => Math.max(m, i.comanda_no), 0) + 1;
    const { error: sendErr } = await svc
      .from("cassa_order_items")
      .update({ status: "sent", comanda_no: comandaNo })
      .eq("order_id", order.id)
      .eq("status", "draft");
    if (sendErr) return { ok: false, error: "pay_failed" };
    items = items.map((i: CassaOrderItemRow) =>
      i.status === "draft" ? { ...i, status: "sent" as const, comanda_no: comandaNo } : i,
    );
  }

  const activeItems = items.filter(isActiveLine);
  const totals = computeTotals(order, items);
  if (activeItems.length === 0 && totals.total <= 0) return { ok: false, error: "empty_order" };

  // Last-line defence: the bill may have changed while the guest was on the
  // Stripe page (staff added a round). The money is real either way — the
  // CALLER records the mismatch and alerts staff; here we only refuse to close.
  if (toCents(totals.total) !== params.expectedTotalCents) {
    return {
      ok: false,
      error: "amount_mismatch",
      expectedCents: params.expectedTotalCents,
      currentCents: toCents(totals.total),
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const { timezone } = await getCassaSettings(svc, tenantId);
  const businessDate = businessDateOf(timezone);
  const receiptYear = Number(businessDate.slice(0, 4));

  const vatRows = vatBreakdown(order, items, fiscal.vat);
  const cuotaTotal = fromCents(vatRows.reduce((s: number, r: { tax: number }) => s + toCents(r.tax), 0));
  const netTotal = fromCents(vatRows.reduce((s: number, r: { net: number }) => s + toCents(r.net), 0));

  const { data: paid, error: payRpcErr } = await svc.rpc("fn_cassa_pay_atomic", {
    p_tenant_id: tenantId,
    p_order_id: order.id,
    p_session_id: session.id,
    p_business_date: businessDate,
    p_year: receiptYear,
    p_closed_at: nowIso,
    p_subtotal: totals.subtotal,
    p_total: totals.total,
    p_discount: totals.discountAmount,
    p_net_total: netTotal,
    p_cuota_total: cuotaTotal,
    p_desglose: toDesglose(fiscal, vatRows),
    p_channel: order.channel,
    p_covers: order.covers,
    p_payment_method: "online",
    p_fiscal: fiscal.register,
    p_obligado_id: fiscal.obligadoId,
    p_serie: fiscal.serie,
    p_fecha_hora_huso: fiscal.register ? fiscalNow(fiscal, now) : null,
    p_sistema: fiscal.sistema,
  });
  if (payRpcErr) {
    await logSystemEvent({
      tenant_id: tenantId,
      category: "api_error",
      severity: "critical",
      title: "Cassa: pagamento QR rifiutato",
      description: `Ordine ${order.id} NON incassato (transazione annullata): ${payRpcErr.message}`,
    });
    return { ok: false, error: "pay_failed" };
  }
  if (!paid?.claimed) return { ok: false, error: "order_not_open" };

  const receiptNumber: number | null = paid.receipt_number ?? null;
  const saleId: string | null = paid.sale_id ?? null;
  const fiscalRecordId: string | null = paid.fiscal_record_id ?? null;

  // ---- payment row (guest-originated → created_by null) ----------------------
  if (totals.total > 0) {
    const { error: payErr } = await svc.from("cassa_payments").insert({
      tenant_id: tenantId,
      order_id: order.id,
      method: "online",
      amount: totals.total,
      received: null,
      created_by: null,
    });
    if (payErr) {
      await logSystemEvent({
        tenant_id: tenantId,
        category: "api_error",
        severity: "critical",
        title: "Cassa: pagamento QR non registrato",
        description: `Ordine ${order.id} chiuso ma insert cassa_payments è fallita: ${payErr.message}`,
      });
    }
  }

  // ---- best-effort side effects: sale lines + stock (mirrors the till) --------
  try {
    if (!saleId) throw new Error("pos_sales header missing from fn_cassa_pay_atomic");
    const menuIds = [...new Set(activeItems.map((i: CassaOrderItemRow) => i.menu_item_id).filter(Boolean))] as string[];
    const categoryByMenuId = new Map<string, string | null>();
    if (menuIds.length > 0) {
      const { data: menuRows } = await svc
        .from("menu_items")
        .select("id, category_id, menu_categories(name)")
        .in("id", menuIds);
      for (const m of menuRows || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        categoryByMenuId.set(m.id as string, (m as any).menu_categories?.name ?? null);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saleItems: any[] = activeItems.map((i: CassaOrderItemRow) => ({
      tenant_id: tenantId,
      sale_id: saleId,
      name: i.name,
      category: i.menu_item_id ? categoryByMenuId.get(i.menu_item_id) ?? null : null,
      quantity: i.qty,
      unit_price: i.unit_price,
      gross_total: fromCents(Math.round(i.qty * toCents(i.unit_price))),
      menu_item_id: i.menu_item_id,
      raw_payload: { cassa_item_id: i.id, course: i.course, notes: i.notes, variants: i.variants ?? [], vat_rate: i.vat_rate },
    }));
    if (totals.coverTotal > 0) {
      saleItems.push({
        tenant_id: tenantId,
        sale_id: saleId,
        name: "Coperto",
        category: null,
        quantity: order.covers,
        unit_price: order.cover_unit,
        gross_total: totals.coverTotal,
        menu_item_id: null,
        raw_payload: { cassa_cover: true },
      });
    }
    if (saleItems.length > 0) {
      const { error: itemsErr } = await svc.from("pos_sale_items").insert(saleItems);
      if (itemsErr) throw new Error(`pos_sale_items: ${itemsErr.message}`);
    }
  } catch (err) {
    await logSystemEvent({
      tenant_id: tenantId,
      category: "api_error",
      severity: "high",
      title: "Cassa: righe vendita non replicate su pos_sale_items",
      description: `Ordine ${order.id} (scontrino ${receiptNumber ?? "—"}): ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  for (const item of activeItems) {
    if (!item.menu_item_id) continue;
    try {
      const { error: rpcErr } = await svc.rpc("fn_consume_stock_for_sale_item", {
        p_tenant_id: tenantId,
        p_menu_item_id: item.menu_item_id,
        p_sold_qty: item.qty,
      });
      if (rpcErr) throw new Error(rpcErr.message);
    } catch (err) {
      await logSystemEvent({
        tenant_id: tenantId,
        category: "api_error",
        severity: "medium",
        title: "Cassa: scarico magazzino fallito",
        description: `Riga "${item.name}" ×${item.qty} (ordine ${order.id}): ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (fiscalRecordId) {
    await flushSubmission(svc, fiscalRecordId).catch(() => {});
  }

  await logAuditEvent({
    tenant_id: tenantId,
    action: "cassa.pay",
    entity_id: order.id,
    // audit_events.source is CHECK-constrained to ai_agent/system/staff — a guest
    // phone is none of them, so it files as 'system' with the origin in details.
    source: "system",
    details: {
      origin: "qr_guest",
      receipt_number: receiptNumber,
      receipt_year: receiptYear,
      total: totals.total,
      payments: [{ method: "online", amount: totals.total }],
      covers: order.covers,
      table: order.table_name,
      num_serie: paid.num_serie ?? null,
      fiscal_record_id: fiscalRecordId,
      huella: paid.huella ?? null,
    },
  });

  return {
    ok: true,
    receiptNumber,
    receiptYear,
    total: totals.total,
    fiscal: fiscalRecordId
      ? {
          num_serie: paid.num_serie as string,
          huella: paid.huella as string,
          nif: fiscal.nif,
          fecha: businessDate,
          importe: totals.total,
        }
      : null,
  };
}
