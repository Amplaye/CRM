import { NextResponse } from "next/server";
import { requireCassaAccess, isAccess, loadOrder, getCassaSettings } from "@/lib/cassa/server";
import {
  computeTotals,
  vatBreakdown,
  remainingDue,
  toCents,
  fromCents,
  dominantMethod,
  businessDateOf,
  isActiveLine,
  type CassaPaymentMethod,
} from "@/lib/cassa/totals";
import { logAuditEvent } from "@/lib/audit";
import { logSystemEvent } from "@/lib/system-log";
import { normalizeGiftCode } from "@/lib/gift-cards/gift-cards";
import { getFiscalContext, assertFiscal, fiscalNow, toDesglose } from "@/lib/fiscal/server";
import { flushSubmission } from "@/lib/fiscal/queue";

// Settle a bill — the money moment of the whole cassa.
//
// POST /api/cassa/orders/[id]/pay
//   { tenant_id, payments: [{ method, amount, received? }] }
//
// What happens, in order:
//   1. the fiscal guard decides whether this till is even ALLOWED to issue a
//      ticket (Spain: only when it is the declared SIF for its NIF);
//   2. totals and the per-rate VAT breakdown are recomputed server-side from the
//      stored lines (client math is display-only, never trusted);
//   3. ONE transaction — fn_cassa_pay_atomic — claims the bill (open → paid),
//      mints the receipt number, writes the canonical pos_sales row WITH its
//      breakdown, and (Spain) chains + queues the fiscal record;
//   4. payment rows are recorded (split bills = several rows);
//   5. sale lines are mirrored into pos_sale_items;
//   6. stock is depleted per recipe via fn_consume_stock_for_sale_item;
//   7. (Spain) the queued record is pushed to AEAT immediately, fire-and-forget.
//
// Step 3 is the change that matters. The claim and the receipt number used to be
// two separate statements: if the second failed, the number was burned and the
// sequence had a hole. Merely annoying in Italy — fatal under a hash-chained
// register, where a hole is an unexplainable gap. Now the whole money moment
// commits or none of it does.
//
// Steps 4-7 remain best-effort: a hiccup there must never un-cash a paid bill —
// it gets logged to system_logs instead. The fiscal record is NOT in that group:
// it is inside the transaction, because an unregistered sale is the offence.

const METHODS: CassaPaymentMethod[] = ["cash", "card", "online", "meal_voucher", "bank_transfer", "gift_card", "other"];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string | undefined = body?.tenant_id;
  const access = await requireCassaAccess(tenantId);
  if (!isAccess(access)) return access;
  const { svc, userId } = access;

  // May this till legally issue a ticket at all? Asked BEFORE anything is claimed:
  // a Spanish venue whose invoices come out of an external POS, or whose fiscal
  // identity was never configured, must be told no while it can still be told no.
  const fiscal = await getFiscalContext(svc, tenantId!);
  const denied = assertFiscal(fiscal);
  if (denied) return denied;

  const loaded = await loadOrder(svc, id);
  if (!loaded || loaded.order.tenant_id !== tenantId) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  const { order } = loaded;
  let items = loaded.items;
  if (order.status !== "open") {
    return NextResponse.json({ error: "order_not_open" }, { status: 409 });
  }

  // Drafts still in the shared cart go out WITH the bill: flip them to sent
  // (next comanda round) before money is derived — another device may have
  // added them a second before this charge landed, and a paid order must never
  // keep "unfired" lines.
  if (items.some((i) => i.status === "draft")) {
    const comandaNo = items.reduce((m, i) => Math.max(m, i.comanda_no), 0) + 1;
    const { error: sendErr } = await svc
      .from("cassa_order_items")
      .update({ status: "sent", comanda_no: comandaNo })
      .eq("order_id", id)
      .eq("status", "draft");
    if (sendErr) return NextResponse.json({ error: sendErr.message }, { status: 500 });
    items = items.map((i) =>
      i.status === "draft" ? { ...i, status: "sent" as const, comanda_no: comandaNo } : i,
    );
  }

  const activeItems = items.filter(isActiveLine);
  const totals = computeTotals(order, items);
  if (activeItems.length === 0 && totals.total <= 0) {
    return NextResponse.json({ error: "empty_order" }, { status: 400 });
  }

  // ---- validate payments against the SERVER total ---------------------------
  const rawPayments: any[] = Array.isArray(body?.payments) ? body.payments : [];
  const payments: { method: CassaPaymentMethod; amount: number; received: number | null; gift_code?: string }[] = [];
  for (const p of rawPayments) {
    const method = METHODS.includes(p?.method) ? (p.method as CassaPaymentMethod) : null;
    const amount = Number(p?.amount);
    if (!method || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "invalid_payments" }, { status: 400 });
    }
    const received =
      method === "cash" && p?.received != null && Number.isFinite(Number(p.received))
        ? Math.round(Number(p.received) * 100) / 100
        : null;
    // A gift-card entry must carry a valid code; normalization fixes till typos.
    let giftCode: string | undefined;
    if (method === "gift_card") {
      const norm = normalizeGiftCode(String(p?.gift_code || ""));
      if (!norm) return NextResponse.json({ error: "invalid_gift_code" }, { status: 400 });
      giftCode = norm;
    }
    payments.push({ method, amount: Math.round(amount * 100) / 100, received, gift_code: giftCode });
  }

  // ---- gift cards: check balances BEFORE claiming the bill -------------------
  // The decrement happens after the claim (below), but an insufficient/unknown
  // voucher must reject the charge upfront, not after the order is already paid.
  const giftEntries = payments.filter((p) => p.method === "gift_card");
  const giftCards = new Map<string, { id: string; balance_cents: number }>();
  if (giftEntries.length > 0) {
    // Several entries may reuse one code (split) — validate the SUM per code.
    const perCode = new Map<string, number>();
    for (const g of giftEntries) {
      perCode.set(g.gift_code!, (perCode.get(g.gift_code!) || 0) + toCents(g.amount));
    }
    for (const [code, cents] of perCode) {
      const { data: card } = await svc
        .from("gift_cards")
        .select("id, balance_cents, status, expires_at")
        .eq("tenant_id", tenantId)
        .eq("code", code)
        .maybeSingle();
      const expired =
        card && (card.status === "expired" || (card.expires_at && new Date(card.expires_at).getTime() < Date.now()));
      if (!card || card.status !== "active" || expired) {
        return NextResponse.json({ error: "gift_card_not_active", code }, { status: 409 });
      }
      if (card.balance_cents < cents) {
        return NextResponse.json(
          { error: "gift_card_insufficient", code, balance_cents: card.balance_cents },
          { status: 409 },
        );
      }
      giftCards.set(code, { id: card.id, balance_cents: card.balance_cents });
    }
  }

  const paidC = payments.reduce((s, p) => s + toCents(p.amount), 0);
  if (totals.total > 0) {
    if (payments.length === 0) return NextResponse.json({ error: "invalid_payments" }, { status: 400 });
    if (paidC !== toCents(totals.total)) {
      return NextResponse.json(
        { error: "payments_mismatch", expected: totals.total, got: fromCents(paidC), remaining: remainingDue(totals.total, payments) },
        { status: 400 },
      );
    }
  } else if (paidC !== 0) {
    // A zero bill (100% discount) closes with no payment rows.
    return NextResponse.json({ error: "payments_mismatch", expected: 0 }, { status: 400 });
  }

  // ---- session: reuse the open one, or auto-open with a zero float ----------
  let { data: session } = await svc
    .from("cassa_sessions")
    .select("id, opening_float")
    .eq("tenant_id", tenantId!)
    .eq("status", "open")
    .maybeSingle();
  if (!session) {
    const { data: created, error: sessErr } = await svc
      .from("cassa_sessions")
      .insert({ tenant_id: tenantId, opened_by: userId })
      .select("id, opening_float")
      .single();
    if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });
    session = created;
  }

  // ---- the money moment: ONE transaction -------------------------------------
  // Claim + receipt number + canonical sale + (Spain) the chained fiscal record.
  // If the fiscal record is rejected — a desglose that doesn't add up, a broken
  // chain — the whole thing rolls back: the order stays OPEN, the counter doesn't
  // move, and the till says no. A refused payment is recoverable; an unregistered
  // one is an offence.
  const now = new Date();
  const nowIso = now.toISOString();
  const { timezone } = await getCassaSettings(svc, tenantId!);
  const businessDate = businessDateOf(timezone);
  const receiptYear = Number(businessDate.slice(0, 4));

  const vatRows = vatBreakdown(order, items, fiscal.vat);
  const cuotaTotal = fromCents(vatRows.reduce((s, r) => s + toCents(r.tax), 0));
  const netTotal = fromCents(vatRows.reduce((s, r) => s + toCents(r.net), 0));

  const { data: paid, error: payRpcErr } = await svc.rpc("fn_cassa_pay_atomic", {
    p_tenant_id: tenantId,
    p_order_id: id,
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
    p_payment_method: payments.length > 0 ? dominantMethod(payments) : "other",
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
      title: "Cassa: pagamento rifiutato",
      description: `Ordine ${id} NON incassato (transazione annullata): ${payRpcErr.message}`,
    });
    return NextResponse.json({ error: "pay_failed", detail: payRpcErr.message }, { status: 500 });
  }
  if (!paid?.claimed) return NextResponse.json({ error: "order_not_open" }, { status: 409 });

  const receiptNumber: number | null = paid.receipt_number ?? null;
  const saleId: string | null = paid.sale_id ?? null;
  const fiscalRecordId: string | null = paid.fiscal_record_id ?? null;

  // ---- gift cards: burn the balance now that the bill is claimed --------------
  // Optimistic lock on the balance we just read: a concurrent redemption of the
  // same code makes the guarded update match nothing → retry once with a fresh
  // read; if it STILL can't cover the amount, log critical (bill already paid —
  // same best-effort contract as a failed cassa_payments insert).
  if (giftCards.size > 0) {
    const perCode = new Map<string, number>();
    for (const g of giftEntries) {
      perCode.set(g.gift_code!, (perCode.get(g.gift_code!) || 0) + toCents(g.amount));
    }
    for (const [code, cents] of perCode) {
      const card = giftCards.get(code)!;
      let redeemed = false;
      let seenBalance = card.balance_cents;
      for (let attempt = 0; attempt < 2 && !redeemed; attempt++) {
        const newBalance = seenBalance - cents;
        if (newBalance < 0) break;
        const { data: updated } = await svc
          .from("gift_cards")
          .update({
            balance_cents: newBalance,
            status: newBalance === 0 ? "redeemed" : "active",
            updated_at: nowIso,
          })
          .eq("id", card.id)
          .eq("balance_cents", seenBalance)
          .eq("status", "active")
          .select("id")
          .maybeSingle();
        if (updated) {
          redeemed = true;
          break;
        }
        const { data: fresh } = await svc
          .from("gift_cards")
          .select("balance_cents, status")
          .eq("id", card.id)
          .maybeSingle();
        if (!fresh || fresh.status !== "active") break;
        seenBalance = fresh.balance_cents;
      }
      if (redeemed) {
        await svc.from("gift_card_redemptions").insert({
          tenant_id: tenantId,
          gift_card_id: card.id,
          order_id: id,
          amount_cents: cents,
          created_by: userId,
        });
      } else {
        await logSystemEvent({
          tenant_id: tenantId,
          category: "api_error",
          severity: "critical",
          title: "Cassa: buono regalo non scalato",
          description: `Ordine ${id}: il buono ${code} (${cents}c) non è stato scalato dopo il pagamento — verificare saldo a mano.`,
        });
      }
    }
  }

  // ---- payments ---------------------------------------------------------------
  if (payments.length > 0) {
    const { error: payErr } = await svc.from("cassa_payments").insert(
      payments.map((p) => ({
        tenant_id: tenantId,
        order_id: id,
        method: p.method,
        amount: p.amount,
        received: p.received,
        created_by: userId,
      })),
    );
    if (payErr) {
      await logSystemEvent({
        tenant_id: tenantId,
        category: "api_error",
        severity: "critical",
        title: "Cassa: pagamento non registrato",
        description: `Ordine ${id} chiuso ma insert cassa_payments è fallita: ${payErr.message}`,
      });
    }
  }

  // ---- best-effort side effects: sale lines + stock ----------------------------
  // The pos_sales HEADER is written by the RPC (in the paid transaction, with its
  // net_total/tax_total finally populated). Only the LINES are written here: they
  // feed menu engineering, and a hiccup on them must not un-cash a paid bill.
  try {
    if (!saleId) throw new Error("pos_sales header missing from fn_cassa_pay_atomic");

    // Category names give menu engineering its grouping for free.
    const menuIds = [...new Set(activeItems.map((i) => i.menu_item_id).filter(Boolean))] as string[];
    const categoryByMenuId = new Map<string, string | null>();
    if (menuIds.length > 0) {
      const { data: menuRows } = await svc
        .from("menu_items")
        .select("id, category_id, menu_categories(name)")
        .in("id", menuIds);
      for (const m of menuRows || []) {
        categoryByMenuId.set(m.id as string, (m as any).menu_categories?.name ?? null);
      }
    }

    const saleItems = activeItems.map((i) => ({
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
        tenant_id: tenantId as any,
        sale_id: saleId,
        name: "Coperto",
        category: null,
        quantity: order.covers,
        unit_price: order.cover_unit,
        gross_total: totals.coverTotal,
        menu_item_id: null,
        raw_payload: { cassa_cover: true } as any,
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
      description: `Ordine ${id} (scontrino ${receiptNumber ?? "—"}): ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Stock depletion per recipe — one call per line with a linked dish.
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
        description: `Riga "${item.name}" ×${item.qty} (ordine ${id}): ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ---- push the record to AEAT, now, without making the guest wait -------------
  // The record is already committed and queued, so this is pure latency reduction:
  // if the network is down the submission stays `pending` and the hourly flush
  // picks it up. The one thing that must never happen is the till refusing to take
  // money because the Agencia Tributaria is slow.
  if (fiscalRecordId) {
    await flushSubmission(svc, fiscalRecordId).catch(() => {});
  }

  await logAuditEvent({
    tenant_id: tenantId!,
    action: "cassa.pay",
    entity_id: id,
    source: "staff",
    details: {
      receipt_number: receiptNumber,
      receipt_year: receiptYear,
      total: totals.total,
      payments: payments.map((p) => ({ method: p.method, amount: p.amount })),
      covers: order.covers,
      table: order.table_name,
      num_serie: paid.num_serie ?? null,
      fiscal_record_id: fiscalRecordId,
      huella: paid.huella ?? null,
    },
  });

  const changeC = payments.reduce(
    (s, p) => s + (p.received != null ? Math.max(0, toCents(p.received) - toCents(p.amount)) : 0),
    0,
  );

  const { data: full } = await svc
    .from("cassa_orders")
    .select("*, items:cassa_order_items(*), payments:cassa_payments(*)")
    .eq("id", id)
    .single();

  return NextResponse.json({
    order: full,
    totals,
    receipt_number: receiptNumber,
    receipt_year: receiptYear,
    change: fromCents(changeC),
    // The printout needs these to draw the QR and the VERI*FACTU legend. Absent for
    // Italy, and PrintSheet keys off exactly that absence.
    fiscal: fiscalRecordId
      ? {
          record_id: fiscalRecordId,
          num_serie: paid.num_serie as string,
          huella: paid.huella as string,
          nif: fiscal.nif,
          fecha: businessDate,
          importe: totals.total,
        }
      : null,
  });
}
