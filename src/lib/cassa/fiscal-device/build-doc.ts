// Costruisce il CommercialDoc (documento commerciale) per l'RT a partire da un
// ordine chiuso della cassa nativa. Le righe (articoli + coperto − sconto) e i
// pagamenti rispecchiano esattamente il totale già incassato da fn_cassa_pay_atomic.

import type { CassaOrderFull } from "@/lib/cassa/types";
import { computeTotals, isActiveLine, DEFAULT_VAT_RATE, COVER_VAT_RATE } from "@/lib/cassa/totals";
import type { CommercialDoc, CommercialDocLine, CommercialDocPayment, CommercialDocPaymentType } from "./types";

function mapPaymentType(method: string): CommercialDocPaymentType {
  switch (method) {
    case "cash":
      return "cash";
    case "card":
    case "online":
    case "bank_transfer":
      return "card";
    case "meal_voucher":
      return "voucher";
    default:
      return "other"; // gift_card, other
  }
}

export function buildCommercialDoc(order: CassaOrderFull): CommercialDoc {
  const active = order.items.filter(isActiveLine);
  const totals = computeTotals(order, order.items);

  const lines: CommercialDocLine[] = active.map((i) => ({
    description: i.name,
    qty: i.qty,
    unitPrice: i.unit_price,
    vatRate: i.vat_rate ?? DEFAULT_VAT_RATE,
  }));

  // Coperto come riga a sé (aliquota coperto), così il totale RT torna col conto.
  if (order.covers > 0 && order.cover_unit > 0) {
    lines.push({
      description: "Coperto",
      qty: order.covers,
      unitPrice: order.cover_unit,
      vatRate: COVER_VAT_RATE,
    });
  }

  const payments: CommercialDocPayment[] = (order.payments || []).map((p) => ({
    type: mapPaymentType(p.method),
    amount: p.amount,
  }));

  return {
    lines,
    payments,
    discount: totals.discountAmount > 0 ? totals.discountAmount : undefined,
  };
}
