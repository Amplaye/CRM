// Native cassa (POS) money math. All arithmetic runs on integer cents so a
// 3-way split of €10.00 comes out 3.34+3.33+3.33 instead of drifting floats.
// The /cassa UI uses these helpers for live display and the API routes recompute
// with the SAME code before persisting — one source of truth, so the screen and
// the stored receipt can never disagree.
//
// NOTE: this module is pure (no supabase, no next) so it is unit-testable and
// safe to import from both client components and route handlers.

export type CassaPaymentMethod =
  | "cash"
  | "card"
  | "online"
  | "meal_voucher"
  | "bank_transfer"
  | "gift_card"
  | "other";

export type CassaDiscountType = "percent" | "amount";

/** The minimal line shape the math needs (server rows and client drafts both fit). */
export interface CassaLineLike {
  unit_price: number;
  qty: number;
  /** "cancelled" lines (storno riga) are excluded from every total. */
  status?: string | null;
  /** % IVA snapshotted on the line; null/absent falls back to DEFAULT_VAT_RATE. */
  vat_rate?: number | null;
}

/** The minimal order shape the math needs. */
export interface CassaOrderLike {
  covers?: number | null;
  /** Cover charge (coperto) PER PERSON, snapshotted on the order at creation. */
  cover_unit?: number | null;
  discount_type?: string | null;
  discount_value?: number | null;
}

export interface CassaPaymentLike {
  method: string;
  amount: number;
}

export interface CassaTotals {
  /** Sum of active lines (before coperto and discount). */
  subtotal: number;
  /** covers × cover_unit. */
  coverTotal: number;
  /** Discount applied on subtotal + coperto, clamped to [0, base]. */
  discountAmount: number;
  /** What the guest pays: subtotal + coperto − discount (never negative). */
  total: number;
}

export function toCents(eur: number | null | undefined): number {
  const n = Number(eur);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function fmtEur(n: number | null | undefined): string {
  const v = Number(n);
  return `${(Number.isFinite(v) ? v : 0).toFixed(2)} €`;
}

export function isActiveLine(line: CassaLineLike): boolean {
  return line.status !== "cancelled";
}

/** qty × unit price of one line, cent-exact (qty may be fractional, e.g. 0.5). */
export function lineTotal(line: CassaLineLike): number {
  const qty = Number(line.qty) || 0;
  return fromCents(Math.round(qty * toCents(line.unit_price)));
}

export function linesSubtotal(lines: CassaLineLike[]): number {
  let cents = 0;
  for (const l of lines) {
    if (!isActiveLine(l)) continue;
    cents += Math.round((Number(l.qty) || 0) * toCents(l.unit_price));
  }
  return fromCents(cents);
}

export function computeTotals(order: CassaOrderLike, lines: CassaLineLike[]): CassaTotals {
  const subtotalC = toCents(linesSubtotal(lines));
  const covers = Math.max(0, Math.round(Number(order.covers) || 0));
  const coverC = covers * Math.max(0, toCents(order.cover_unit));
  const baseC = subtotalC + coverC;

  let discountC = 0;
  const value = Math.max(0, Number(order.discount_value) || 0);
  if (order.discount_type === "percent") {
    // Clamp the percentage to 100 so a typo can never produce a negative bill.
    discountC = Math.round((baseC * Math.min(value, 100)) / 100);
  } else if (order.discount_type === "amount") {
    discountC = Math.min(toCents(value), baseC);
  }

  return {
    subtotal: fromCents(subtotalC),
    coverTotal: fromCents(coverC),
    discountAmount: fromCents(discountC),
    total: fromCents(baseC - discountC),
  };
}

/** What is still owed after the given payments (never negative). */
export function remainingDue(total: number, payments: CassaPaymentLike[]): number {
  let paidC = 0;
  for (const p of payments) paidC += toCents(p.amount);
  return fromCents(Math.max(0, toCents(total) - paidC));
}

/** Change to hand back on a cash tender (never negative). */
export function changeDue(received: number, due: number): number {
  return fromCents(Math.max(0, toCents(received) - toCents(due)));
}

/** Split "alla romana": n equal parts, remainder cents on the FIRST parts, so the
 * parts always sum exactly to the total (10.00 / 3 → 3.34, 3.33, 3.33). */
export function splitEqual(total: number, parts: number): number[] {
  const n = Math.max(1, Math.floor(parts));
  const cents = toCents(total);
  const base = Math.floor(cents / n);
  const rem = cents - base * n;
  return Array.from({ length: n }, (_, i) => fromCents(base + (i < rem ? 1 : 0)));
}

/** The single payment_method to report on pos_sales when a bill was settled with
 * a mix (e.g. half cash half card): the method that carried the largest amount. */
export function dominantMethod(payments: CassaPaymentLike[]): CassaPaymentMethod {
  const sums = new Map<string, number>();
  for (const p of payments) {
    sums.set(p.method, (sums.get(p.method) || 0) + toCents(p.amount));
  }
  let best: string | null = null;
  let bestC = -1;
  for (const [m, c] of sums) {
    if (c > bestC) { best = m; bestC = c; }
  }
  const known: CassaPaymentMethod[] = ["cash", "card", "online", "meal_voucher", "bank_transfer", "gift_card", "other"];
  return known.includes(best as CassaPaymentMethod) ? (best as CassaPaymentMethod) : "other";
}

/** Local calendar date (YYYY-MM-DD) in the venue's timezone — the service day a
 * receipt belongs to. NEVER use the UTC date near midnight (learned the hard way). */
export function businessDateOf(timezone: string | null | undefined, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    // Unknown tz string → fall back to Europe/Rome rather than crash a payment.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  }
}

// ---------------------------------------------------------------------------
// IVA (scorporo) — prices are VAT-INCLUSIVE, the receipt shows the breakdown
// ---------------------------------------------------------------------------

/** Restaurant service (somministrazione) default when an item has no rate — the
 * ITALIAN one. It used to be the only truth in the codebase; it is now merely the
 * default, because a Canary tenant is on IGIC and has no 10% band at all. The
 * effective rates arrive as a VatConfig from src/lib/fiscal/regions.ts. */
export const DEFAULT_VAT_RATE = 10;

/** The coperto is part of the service, so it carries the somministrazione rate. */
export const COVER_VAT_RATE = 10;

/** The two numbers the money math needs from the tenant's tax regime. Structurally
 * identical to fiscal/regions.ts VatConfig, declared here so totals.ts stays pure:
 * it RECEIVES the config, it never goes looking for one. */
export interface VatConfig {
  defaultRate: number;
  coverRate: number;
}

const IT_VAT: VatConfig = { defaultRate: DEFAULT_VAT_RATE, coverRate: COVER_VAT_RATE };

export interface VatLine {
  /** % rate, e.g. 10. */
  rate: number;
  /** VAT-inclusive amount that fell under this rate (after discount). */
  gross: number;
  /** Imponibile: gross / (1 + rate/100). */
  net: number;
  /** Imposta: gross − net. */
  tax: number;
}

function normalizeRate(rate: number | null | undefined, fallback: number): number {
  const r = Number(rate);
  return Number.isFinite(r) && r >= 0 && r <= 100 ? Math.round(r * 100) / 100 : fallback;
}

/**
 * Per-rate VAT breakdown of a (VAT-inclusive) bill. The order discount is
 * spread across the rates proportionally to their gross, with the remainder
 * cents assigned largest-share-first so the rows always sum EXACTLY to the
 * bill total. Rates ascending; empty when the bill is zero.
 *
 * `vat` carries the tenant's regime (Italian rates when omitted, which is what
 * every existing caller had baked in). Under VeriFactu this breakdown stops being
 * a printout detail and becomes the desglose AEAT registers, so the rows summing
 * exactly to the total is now a legal property, not a cosmetic one.
 */
export function vatBreakdown(
  order: CassaOrderLike,
  lines: CassaLineLike[],
  vat: VatConfig = IT_VAT,
): VatLine[] {
  // 1) gross per rate (line prices already include IVA and any variant delta)
  const grossC = new Map<number, number>();
  for (const l of lines) {
    if (!isActiveLine(l)) continue;
    const cents = Math.round((Number(l.qty) || 0) * toCents(l.unit_price));
    if (cents === 0) continue;
    const rate = normalizeRate(l.vat_rate, vat.defaultRate);
    grossC.set(rate, (grossC.get(rate) || 0) + cents);
  }
  const covers = Math.max(0, Math.round(Number(order.covers) || 0));
  const coverC = covers * Math.max(0, toCents(order.cover_unit));
  if (coverC > 0) grossC.set(vat.coverRate, (grossC.get(vat.coverRate) || 0) + coverC);

  const baseC = [...grossC.values()].reduce((s, c) => s + c, 0);
  if (baseC <= 0) return [];

  // 2) spread the discount proportionally (largest remainder keeps the sum exact)
  const discountC = toCents(computeTotals(order, lines).discountAmount);
  const rates = [...grossC.entries()].sort((a, b) => a[0] - b[0]);
  const shares = rates.map(([rate, cents]) => {
    const exact = (discountC * cents) / baseC;
    return { rate, cents, cut: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let leftover = discountC - shares.reduce((s, x) => s + x.cut, 0);
  for (const s of [...shares].sort((a, b) => b.frac - a.frac)) {
    if (leftover <= 0) break;
    s.cut += 1;
    leftover -= 1;
  }

  // 3) scorporo per rate on the discounted gross
  return shares.map(({ rate, cents, cut }) => {
    const gross = cents - cut;
    const net = Math.round(gross / (1 + rate / 100));
    return { rate, gross: fromCents(gross), net: fromCents(net), tax: fromCents(gross - net) };
  });
}

/** Group active lines by course (portata) for the kitchen ticket, courses ascending. */
export function comandaCourses<T extends CassaLineLike & { course?: number | null }>(
  lines: T[],
): Array<{ course: number; lines: T[] }> {
  const byCourse = new Map<number, T[]>();
  for (const l of lines) {
    if (!isActiveLine(l)) continue;
    const c = Math.max(1, Math.round(Number(l.course) || 1));
    if (!byCourse.has(c)) byCourse.set(c, []);
    byCourse.get(c)!.push(l);
  }
  return [...byCourse.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([course, ls]) => ({ course, lines: ls }));
}

/** Group active lines by prep station (reparto) for per-printer comande.
 * Lines with no station land in the `null` group; groups keep first-seen order
 * with the no-station group last. */
export function comandaStations<T extends CassaLineLike & { station?: string | null }>(
  lines: T[],
): Array<{ station: string | null; lines: T[] }> {
  const byStation = new Map<string | null, T[]>();
  for (const l of lines) {
    if (!isActiveLine(l)) continue;
    const s = typeof l.station === "string" && l.station.trim() ? l.station : null;
    if (!byStation.has(s)) byStation.set(s, []);
    byStation.get(s)!.push(l);
  }
  return [...byStation.entries()]
    .sort((a, b) => (a[0] === null ? 1 : 0) - (b[0] === null ? 1 : 0))
    .map(([station, ls]) => ({ station, lines: ls }));
}

// ---------------------------------------------------------------------------
// Session (giornata di cassa) reporting
// ---------------------------------------------------------------------------

export interface SessionReceiptLike {
  status: string; // "paid" | "void" (open/cancelled orders never reach the report)
  total: number;
  covers?: number | null;
  discount_amount?: number | null;
  payments: CassaPaymentLike[];
}

export interface SessionSummary {
  /** Number of PAID receipts (voided ones excluded). */
  receipts: number;
  voids: number;
  /** Gross takings of paid receipts. */
  gross: number;
  covers: number;
  /** gross / receipts, 0 when no receipts. */
  avgReceipt: number;
  discounts: number;
  /** € collected per payment method (paid receipts only). */
  byMethod: Partial<Record<CassaPaymentMethod, number>>;
  /** opening float + cash takings — what should be in the drawer. */
  expectedCash: number;
}

export function sessionSummary(
  receipts: SessionReceiptLike[],
  openingFloat: number,
): SessionSummary {
  let grossC = 0;
  let covers = 0;
  let discountsC = 0;
  let paidCount = 0;
  let voidCount = 0;
  const byMethodC = new Map<string, number>();

  for (const r of receipts) {
    if (r.status === "void") { voidCount++; continue; }
    if (r.status !== "paid") continue;
    paidCount++;
    grossC += toCents(r.total);
    covers += Math.max(0, Math.round(Number(r.covers) || 0));
    discountsC += toCents(r.discount_amount);
    for (const p of r.payments) {
      byMethodC.set(p.method, (byMethodC.get(p.method) || 0) + toCents(p.amount));
    }
  }

  const byMethod: SessionSummary["byMethod"] = {};
  for (const [m, c] of byMethodC) byMethod[m as CassaPaymentMethod] = fromCents(c);

  return {
    receipts: paidCount,
    voids: voidCount,
    gross: fromCents(grossC),
    covers,
    avgReceipt: paidCount > 0 ? fromCents(Math.round(grossC / paidCount)) : 0,
    discounts: fromCents(discountsC),
    byMethod,
    expectedCash: fromCents(toCents(openingFloat) + (byMethodC.get("cash") || 0)),
  };
}
