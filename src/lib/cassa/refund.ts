// Il calcolo di un reso parziale (rettificativa R5).
//
// Il problema, in una riga: se il cliente ha pagato uno scontrino da 40 € con uno
// sconto del 10% e rende due birre da 5 €, NON gli si rendono 10 €. Le birre hanno
// già assorbito la loro quota di sconto — se ne rendono 9. Rendere il prezzo di
// listino significherebbe restituire più denaro di quanto se ne è incassato per
// quelle righe, e la differenza uscirebbe di tasca al ristoratore, in silenzio,
// una rettifica alla volta.
//
// Quindi il reso non si calcola sulle righe rese in isolamento: si calcola come
// DIFFERENZA fra il conto com'era e il conto come sarebbe stato senza quelle righe.
// Lo sconto proporzionale, l'arrotondamento al centesimo e la ripartizione per
// aliquota sono già risolti — una volta sola, correttamente — dentro vatBreakdown().
// Qui la si chiama due volte e si sottrae. Nessuna seconda implementazione della
// matematica dei soldi: quella strada porta a due verità che divergono.
//
// Il risultato è NEGATIVO per costruzione (è un delta "por diferencias", cioè ciò
// che va sommato all'originale per arrivare al vero), ed è quello che finisce sia
// nella riga compensativa di pos_sales sia nel desglose che AEAT registra.

import type { CassaLineLike, CassaOrderLike, VatConfig, VatLine } from "./totals";
import { computeTotals, isActiveLine, toCents, fromCents, vatBreakdown } from "./totals";

/** Quante unità di una riga si stanno rendendo. */
export interface RefundSelection {
  /** id della riga di cassa_order_items */
  line_id: string;
  qty: number;
}

export interface RefundQuote {
  /** Totale reso, NEGATIVO (es. −9.00). */
  importeTotal: number;
  /** Imponibile reso, NEGATIVO. */
  netTotal: number;
  /** Imposta resa, NEGATIVA. */
  cuotaTotal: number;
  /** Righe per aliquota, tutte con importi NEGATIVI. Vuoto se non si rende nulla. */
  rows: VatLine[];
  /** Le righe selezionate, come le mostrerà lo scontrino di reso. */
  lines: Array<{ line_id: string; name: string; qty: number; amount: number }>;
}

/** Sottrae b da a, per aliquota, tenendo solo le aliquote con un delta non nullo. */
function diffByRate(before: VatLine[], after: VatLine[]): VatLine[] {
  const rates = new Set([...before.map((r) => r.rate), ...after.map((r) => r.rate)]);
  const pick = (rows: VatLine[], rate: number) => rows.find((r) => r.rate === rate);

  const out: VatLine[] = [];
  for (const rate of [...rates].sort((a, b) => a - b)) {
    const b = pick(before, rate);
    const a = pick(after, rate);
    // In centesimi: sottrarre due float in euro reintrodurrebbe proprio l'errore
    // che vatBreakdown ha appena finito di eliminare.
    const gross = (toCents(a?.gross) || 0) - (toCents(b?.gross) || 0);
    const net = (toCents(a?.net) || 0) - (toCents(b?.net) || 0);
    const tax = (toCents(a?.tax) || 0) - (toCents(b?.tax) || 0);
    if (gross === 0 && net === 0 && tax === 0) continue;
    out.push({ rate, gross: fromCents(gross), net: fromCents(net), tax: fromCents(tax) });
  }
  return out;
}

/**
 * Il preventivo del reso: quanto va restituito, e come si scompone per aliquota.
 *
 * `after` è il conto ipotetico in cui le righe rese non erano mai state ordinate
 * (quantità ridotte, righe azzerate rimosse). Il delta fra i due conti È il reso —
 * sconto già dedotto, IVA già ripartita, centesimi già quadrati.
 *
 * I coperti non si rendono mai: il cliente si è seduto. Restano identici nei due
 * conti e quindi si annullano nella differenza, senza bisogno di codice apposito.
 */
export function quoteRefund(
  order: CassaOrderLike,
  lines: CassaLineLike[],
  selection: RefundSelection[],
  vat?: VatConfig,
): RefundQuote {
  const active = lines.filter(isActiveLine);
  const wanted = new Map<string, number>();
  for (const s of selection) {
    const q = Math.max(0, Math.floor(Number(s.qty) || 0));
    if (q > 0) wanted.set(s.line_id, (wanted.get(s.line_id) || 0) + q);
  }

  // Il conto "senza le righe rese". Una quantità di reso maggiore del venduto viene
  // tosata al venduto: rendere tre birre su due non significa nulla.
  const after: CassaLineLike[] = [];
  const picked: RefundQuote["lines"] = [];
  for (const l of active) {
    const id = (l as CassaLineLike & { id?: string }).id ?? "";
    const take = Math.min(Number(l.qty) || 0, wanted.get(id) || 0);
    const left = (Number(l.qty) || 0) - take;

    if (take > 0) {
      picked.push({
        line_id: id,
        name: (l as CassaLineLike & { name?: string }).name ?? "",
        qty: take,
        amount: fromCents(Math.round(take * toCents(l.unit_price))),
      });
    }
    // Una riga resa per intero sparisce dal conto ipotetico; una resa in parte
    // sopravvive con la quantità residua.
    if (left > 0) after.push({ ...l, qty: left });
  }

  if (picked.length === 0) {
    return { importeTotal: 0, netTotal: 0, cuotaTotal: 0, rows: [], lines: [] };
  }

  const beforeRows = vatBreakdown(order, active, vat);
  // Lo sconto dell'ordine è una percentuale o un importo: computeTotals lo riapplica
  // al conto ridotto esattamente come farebbe la cassa, quindi il delta include
  // automaticamente la quota di sconto che le righe rese portavano con sé.
  const afterRows = vatBreakdown(order, after, vat);
  const rows = diffByRate(beforeRows, afterRows);

  const beforeTotal = toCents(computeTotals(order, active).total);
  const afterTotal = toCents(computeTotals(order, after).total);
  const importeC = afterTotal - beforeTotal; // ≤ 0

  const netC = rows.reduce((s, r) => s + toCents(r.net), 0);
  const cuotaC = rows.reduce((s, r) => s + toCents(r.tax), 0);

  return {
    importeTotal: fromCents(importeC),
    netTotal: fromCents(netC),
    cuotaTotal: fromCents(cuotaC),
    rows,
    lines: picked,
  };
}
