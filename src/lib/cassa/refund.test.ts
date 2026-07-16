import { describe, it, expect } from "vitest";
import { quoteRefund } from "./refund";
import { computeTotals, toCents } from "./totals";
import type { CassaLineLike, CassaOrderLike } from "./totals";

const IGIC = { defaultRate: 7, coverRate: 7 };

function line(id: string, name: string, price: number, qty: number, vat_rate?: number): CassaLineLike & { id: string; name: string } {
  return { id, name, unit_price: price, qty, vat_rate: vat_rate ?? null, status: "active" } as any;
}

function order(over: Partial<CassaOrderLike> = {}): CassaOrderLike {
  return { covers: 0, cover_unit: 0, discount_type: null, discount_value: 0, ...over } as CassaOrderLike;
}

describe("quoteRefund", () => {
  it("rende il prezzo pieno quando non c'è sconto", () => {
    const lines = [line("a", "Birra", 5, 5)];
    const q = quoteRefund(order(), lines, [{ line_id: "a", qty: 2 }]);

    expect(q.importeTotal).toBe(-10);
    expect(q.lines).toEqual([{ line_id: "a", name: "Birra", qty: 2, amount: 10 }]);
    // 10 € al 10%: imponibile 9,09 + IVA 0,91
    expect(q.netTotal).toBeCloseTo(-9.09, 2);
    expect(q.cuotaTotal).toBeCloseTo(-0.91, 2);
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0].rate).toBe(10);
  });

  it("NON rende il prezzo di listino se lo scontrino aveva uno sconto", () => {
    // 8 birre × 5 € = 40 €, sconto 10% → il cliente ha pagato 36 €.
    // Rendendo 2 birre si rendono 9 €, non 10: quelle birre hanno incassato 4,50 l'una.
    const lines = [line("a", "Birra", 5, 8)];
    const o = order({ discount_type: "percent", discount_value: 10 });
    expect(computeTotals(o, lines).total).toBe(36);

    const q = quoteRefund(o, lines, [{ line_id: "a", qty: 2 }]);
    expect(q.importeTotal).toBe(-9);
  });

  it("il reso è sempre la differenza esatta fra i due conti (nessun centesimo perso)", () => {
    // Aliquote miste + sconto a importo: il caso in cui gli arrotondamenti fanno male.
    const lines = [line("a", "Vino", 7.9, 3, 22), line("b", "Pizza", 8.5, 4, 10)];
    const o = order({ discount_type: "amount", discount_value: 5.37 });

    const before = toCents(computeTotals(o, lines).total);
    const q = quoteRefund(o, lines, [{ line_id: "a", qty: 1 }, { line_id: "b", qty: 2 }]);

    const after = toCents(computeTotals(o, [line("a", "Vino", 7.9, 2, 22), line("b", "Pizza", 8.5, 2, 10)]).total);
    expect(toCents(q.importeTotal)).toBe(after - before);

    // Le righe per aliquota sommano ESATTAMENTE al totale reso: è la proprietà che
    // AEAT verifica (base + cuota = importe), e che fn_fiscal_assert_desglose impone.
    const sum = q.rows.reduce((s, r) => s + toCents(r.net) + toCents(r.tax), 0);
    expect(sum).toBe(toCents(q.importeTotal));
  });

  it("separa le aliquote: rendendo solo il vino, l'IVA resa è tutta al 22%", () => {
    const lines = [line("a", "Vino", 10, 2, 22), line("b", "Pizza", 10, 2, 10)];
    const q = quoteRefund(order(), lines, [{ line_id: "a", qty: 2 }]);

    expect(q.rows).toHaveLength(1);
    expect(q.rows[0].rate).toBe(22);
    expect(q.importeTotal).toBe(-20);
  });

  it("usa il regime del tenant: sotto IGIC non esiste una banda al 10%", () => {
    const lines = [line("a", "Cerveza", 5, 2)]; // nessuna aliquota esplicita → fallback del regime
    const q = quoteRefund(order(), lines, [{ line_id: "a", qty: 2 }], IGIC);

    expect(q.rows).toHaveLength(1);
    expect(q.rows[0].rate).toBe(7);
  });

  it("i coperti non si rendono: il cliente si è seduto comunque", () => {
    const lines = [line("a", "Birra", 5, 2)];
    const o = order({ covers: 4, cover_unit: 2 }); // 8 € di coperto
    const q = quoteRefund(o, lines, [{ line_id: "a", qty: 2 }]);

    // Si rendono le birre (10 €), non il coperto.
    expect(q.importeTotal).toBe(-10);
  });

  it("rendere l'intero scontrino restituisce esattamente il totale pagato", () => {
    const lines = [line("a", "Vino", 7.9, 3, 22), line("b", "Pizza", 8.5, 4, 10)];
    const o = order({ discount_type: "percent", discount_value: 15 });
    const total = computeTotals(o, lines).total;

    const q = quoteRefund(o, lines, [{ line_id: "a", qty: 3 }, { line_id: "b", qty: 4 }]);
    expect(toCents(q.importeTotal)).toBe(-toCents(total));
  });

  it("una quantità oltre il venduto viene tosata al venduto", () => {
    const lines = [line("a", "Birra", 5, 2)];
    const q = quoteRefund(order(), lines, [{ line_id: "a", qty: 99 }]);

    expect(q.importeTotal).toBe(-10);
    expect(q.lines[0].qty).toBe(2);
  });

  it("una selezione vuota non è un reso", () => {
    const lines = [line("a", "Birra", 5, 2)];
    const q = quoteRefund(order(), lines, [{ line_id: "a", qty: 0 }]);

    expect(q.importeTotal).toBe(0);
    expect(q.rows).toEqual([]);
    expect(q.lines).toEqual([]);
  });

  it("ignora le righe annullate: non sono mai state vendute", () => {
    const lines = [line("a", "Birra", 5, 2), { ...line("b", "Vino", 9, 1), status: "cancelled" } as any];
    const q = quoteRefund(order(), lines, [{ line_id: "b", qty: 1 }]);

    expect(q.importeTotal).toBe(0);
  });
});
