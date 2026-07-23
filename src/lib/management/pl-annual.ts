// Annual P&L — the 12-months-in-a-row income statement (iammi's "conto economico
// annuale"). Pure assembly of already-bucketed monthly data into a cost tree:
// Ricavi → materia prima (food/beverage/consumables) → personale → struttura →
// affitto → margine operativo, each row carrying € per month and % of revenue.
//
// Kept dumb and pure so it's unit-testable; the page does the DB bucketing.

export type YearLeaf = { key: string; label: string; monthly: number[] };

export type PlYearInput = {
  /** 12 monthly revenue values (already net or gross per the VAT choice). */
  revenue: number[];
  covers: number[];
  /** Distinct trading days per month (days with at least one sale). */
  openDays: number[];
  /** Materia prima branch: food / beverage / consumables (magnitudes). */
  cogs: YearLeaf[];
  labor: number[];
  /** Fixed structure costs (overhead + service bills), one leaf per category. */
  structure: YearLeaf[];
  rent: number[];
};

export type PlYearRow = {
  key: string;
  kind: "revenue" | "cost" | "result";
  /** Cost magnitudes are positive; the UI prints the leading − sign. */
  monthly: number[];
  total: number;
  /** % of revenue per month (null when that month has no revenue). */
  pct: (number | null)[];
  totalPct: number | null;
  children?: Array<{ key: string; label: string; monthly: number[]; total: number }>;
};

export type PlYear = {
  rows: PlYearRow[];
  revenue: number[];
  revenueTotal: number;
  openDays: number[];
  covers: number[];
  /** Revenue ÷ trading days, per month. */
  salesPerDay: number[];
};

const MONTHS = 12;
const zero = () => new Array<number>(MONTHS).fill(0);
const round2 = (n: number) => Math.round(n * 100) / 100;

function sumLeaves(leaves: YearLeaf[]): number[] {
  const out = zero();
  for (const l of leaves) for (let m = 0; m < MONTHS; m++) out[m] += l.monthly[m] || 0;
  return out.map(round2);
}
const sum = (a: number[]) => round2(a.reduce((s, n) => s + (n || 0), 0));

export function buildPlYear(input: PlYearInput): PlYear {
  const revenue = input.revenue.map(round2);
  const cogsMonthly = sumLeaves(input.cogs);
  const structMonthly = sumLeaves(input.structure);
  const labor = input.labor.map(round2);
  const rent = input.rent.map(round2);

  const margin = zero().map((_, m) =>
    round2(revenue[m] - cogsMonthly[m] - labor[m] - structMonthly[m] - rent[m]),
  );

  const pctOf = (monthly: number[]): (number | null)[] =>
    monthly.map((v, m) => (revenue[m] > 0 ? round2((v / revenue[m]) * 100) : null));

  const revenueTotal = sum(revenue);
  const row = (
    key: string,
    kind: PlYearRow["kind"],
    monthly: number[],
    children?: YearLeaf[],
  ): PlYearRow => {
    const total = sum(monthly);
    return {
      key,
      kind,
      monthly,
      total,
      pct: pctOf(monthly),
      totalPct: revenueTotal > 0 ? round2((total / revenueTotal) * 100) : null,
      children: children?.map((c) => ({ key: c.key, label: c.label, monthly: c.monthly.map(round2), total: sum(c.monthly) })),
    };
  };

  const rows: PlYearRow[] = [
    row("revenue", "revenue", revenue),
    row("cogs", "cost", cogsMonthly, input.cogs),
    row("labor", "cost", labor),
    row("structure", "cost", structMonthly, input.structure),
    row("rent", "cost", rent),
    row("margin", "result", margin),
  ];

  return {
    rows,
    revenue,
    revenueTotal,
    openDays: input.openDays.slice(0, MONTHS),
    covers: input.covers.map((n) => n || 0),
    salesPerDay: revenue.map((r, m) => (input.openDays[m] > 0 ? round2(r / input.openDays[m]) : 0)),
  };
}

/** Rent detection from a free-text overhead/category label, across our locales. */
export function isRentCategory(label: string): boolean {
  return /affitt|locazion|\brent\b|miete|alquiler|loyer|pigione/i.test(label);
}
