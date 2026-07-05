import { describe, it, expect } from "vitest";
import {
  toCents,
  fromCents,
  fmtEur,
  lineTotal,
  linesSubtotal,
  computeTotals,
  remainingDue,
  changeDue,
  splitEqual,
  dominantMethod,
  businessDateOf,
  comandaCourses,
  comandaStations,
  vatBreakdown,
  sessionSummary,
} from "./totals";

describe("cents helpers", () => {
  it("round-trips euros through cents", () => {
    expect(toCents(12.5)).toBe(1250);
    expect(toCents(0.1)).toBe(10);
    expect(fromCents(1250)).toBe(12.5);
    // The classic float trap: 19.99 * 100 = 1998.9999…
    expect(toCents(19.99)).toBe(1999);
  });

  it("treats garbage as zero", () => {
    expect(toCents(undefined)).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(NaN)).toBe(0);
  });

  it("formats euros", () => {
    expect(fmtEur(12.5)).toBe("12.50 €");
    expect(fmtEur(null)).toBe("0.00 €");
  });
});

describe("line math", () => {
  it("computes qty × price cent-exactly", () => {
    expect(lineTotal({ unit_price: 3.3, qty: 3 })).toBe(9.9);
    expect(lineTotal({ unit_price: 19.99, qty: 2 })).toBe(39.98);
    // Fractional qty (half portion)
    expect(lineTotal({ unit_price: 9.0, qty: 0.5 })).toBe(4.5);
  });

  it("sums only active lines", () => {
    const lines = [
      { unit_price: 10, qty: 1 },
      { unit_price: 5, qty: 2, status: "sent" },
      { unit_price: 100, qty: 1, status: "cancelled" },
    ];
    expect(linesSubtotal(lines)).toBe(20);
  });
});

describe("computeTotals", () => {
  const lines = [
    { unit_price: 12, qty: 2, status: "sent" }, // 24
    { unit_price: 4.5, qty: 1, status: "sent" }, // 4.5
    { unit_price: 99, qty: 1, status: "cancelled" }, // storno — ignored
  ];

  it("adds the coperto per cover", () => {
    const t = computeTotals({ covers: 4, cover_unit: 2 }, lines);
    expect(t.subtotal).toBe(28.5);
    expect(t.coverTotal).toBe(8);
    expect(t.discountAmount).toBe(0);
    expect(t.total).toBe(36.5);
  });

  it("applies a percent discount on subtotal + coperto", () => {
    const t = computeTotals(
      { covers: 2, cover_unit: 1.5, discount_type: "percent", discount_value: 10 },
      lines,
    );
    // base = 28.50 + 3.00 = 31.50 → 10% = 3.15
    expect(t.discountAmount).toBe(3.15);
    expect(t.total).toBe(28.35);
  });

  it("applies a fixed discount and clamps it to the bill", () => {
    const t = computeTotals({ discount_type: "amount", discount_value: 5 }, lines);
    expect(t.total).toBe(23.5);
    const clamped = computeTotals({ discount_type: "amount", discount_value: 999 }, lines);
    expect(clamped.discountAmount).toBe(28.5);
    expect(clamped.total).toBe(0);
  });

  it("clamps a percent typo above 100 and never goes negative", () => {
    const t = computeTotals({ discount_type: "percent", discount_value: 250 }, lines);
    expect(t.total).toBe(0);
  });

  it("ignores negative covers and negative discounts", () => {
    const t = computeTotals(
      { covers: -3, cover_unit: 2, discount_type: "amount", discount_value: -10 },
      lines,
    );
    expect(t.coverTotal).toBe(0);
    expect(t.discountAmount).toBe(0);
    expect(t.total).toBe(28.5);
  });

  it("handles an empty order", () => {
    const t = computeTotals({}, []);
    expect(t).toEqual({ subtotal: 0, coverTotal: 0, discountAmount: 0, total: 0 });
  });
});

describe("payments", () => {
  it("computes the remaining due, floored at zero", () => {
    expect(remainingDue(50, [{ method: "cash", amount: 20 }])).toBe(30);
    expect(remainingDue(50, [{ method: "cash", amount: 20 }, { method: "card", amount: 30 }])).toBe(0);
    expect(remainingDue(50, [{ method: "cash", amount: 60 }])).toBe(0);
    // Cent-exact: 10 − (3.34 + 3.33 + 3.33) = 0, not 0.0000000001
    expect(
      remainingDue(10, [
        { method: "cash", amount: 3.34 },
        { method: "cash", amount: 3.33 },
        { method: "cash", amount: 3.33 },
      ]),
    ).toBe(0);
  });

  it("computes the change on a cash tender", () => {
    expect(changeDue(50, 36.5)).toBe(13.5);
    expect(changeDue(20, 36.5)).toBe(0); // under-tender → no change
  });

  it("splits alla romana with the remainder on the first parts", () => {
    expect(splitEqual(10, 3)).toEqual([3.34, 3.33, 3.33]);
    expect(splitEqual(100, 4)).toEqual([25, 25, 25, 25]);
    expect(splitEqual(0.05, 4)).toEqual([0.02, 0.01, 0.01, 0.01]);
    // Parts always sum back to the total
    const parts = splitEqual(73.21, 6);
    expect(fromCents(parts.reduce((s, p) => s + toCents(p), 0))).toBe(73.21);
    // Degenerate input
    expect(splitEqual(10, 0)).toEqual([10]);
  });

  it("picks the dominant method for the pos_sales report", () => {
    expect(
      dominantMethod([
        { method: "cash", amount: 10 },
        { method: "card", amount: 40 },
      ]),
    ).toBe("card");
    expect(dominantMethod([{ method: "cash", amount: 5 }])).toBe("cash");
    // Unknown method labels degrade to "other" instead of breaking the enum
    expect(dominantMethod([{ method: "crypto", amount: 5 }])).toBe("other");
    expect(dominantMethod([])).toBe("other");
  });
});

describe("businessDateOf", () => {
  it("uses the venue timezone, not UTC", () => {
    // 2026-07-04 22:30 UTC is already July 5th in Rome (UTC+2 in summer)…
    const at = new Date("2026-07-04T22:30:00Z");
    expect(businessDateOf("Europe/Rome", at)).toBe("2026-07-05");
    // …but still July 4th in the Canaries (UTC+1 in summer)
    expect(businessDateOf("Atlantic/Canary", at)).toBe("2026-07-04");
  });

  it("falls back to Europe/Rome on an invalid timezone", () => {
    const at = new Date("2026-01-10T12:00:00Z");
    expect(businessDateOf("Not/AZone", at)).toBe("2026-01-10");
  });
});

describe("comandaCourses", () => {
  it("groups active lines by course, ascending", () => {
    const lines = [
      { unit_price: 10, qty: 1, course: 2, name: "Tagliata" },
      { unit_price: 8, qty: 2, course: 1, name: "Bruschette" },
      { unit_price: 5, qty: 1, course: 2, status: "cancelled", name: "Storno" },
      { unit_price: 6, qty: 1, course: 1, name: "Olive" },
    ];
    const groups = comandaCourses(lines);
    expect(groups.map((g) => g.course)).toEqual([1, 2]);
    expect(groups[0].lines.map((l: any) => l.name)).toEqual(["Bruschette", "Olive"]);
    expect(groups[1].lines.map((l: any) => l.name)).toEqual(["Tagliata"]);
  });

  it("defaults a missing course to 1", () => {
    const groups = comandaCourses([{ unit_price: 1, qty: 1 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].course).toBe(1);
  });
});

describe("sessionSummary", () => {
  const receipts = [
    {
      status: "paid",
      total: 40,
      covers: 2,
      discount_amount: 0,
      payments: [{ method: "cash", amount: 40 }],
    },
    {
      status: "paid",
      total: 60,
      covers: 3,
      discount_amount: 5,
      payments: [
        { method: "cash", amount: 20 },
        { method: "card", amount: 40 },
      ],
    },
    {
      status: "void",
      total: 25,
      covers: 1,
      discount_amount: 0,
      payments: [{ method: "cash", amount: 25 }],
    },
  ];

  it("aggregates paid receipts and excludes voids from money", () => {
    const s = sessionSummary(receipts, 100);
    expect(s.receipts).toBe(2);
    expect(s.voids).toBe(1);
    expect(s.gross).toBe(100);
    expect(s.covers).toBe(5);
    expect(s.avgReceipt).toBe(50);
    expect(s.discounts).toBe(5);
    expect(s.byMethod.cash).toBe(60);
    expect(s.byMethod.card).toBe(40);
    // Drawer: 100 float + 60 cash (the voided 25 was handed back)
    expect(s.expectedCash).toBe(160);
  });

  it("handles an empty day", () => {
    const s = sessionSummary([], 50);
    expect(s.receipts).toBe(0);
    expect(s.gross).toBe(0);
    expect(s.avgReceipt).toBe(0);
    expect(s.expectedCash).toBe(50);
  });
});

describe("vatBreakdown", () => {
  it("splits the scorporo per rate on a VAT-inclusive bill", () => {
    const lines = [
      { unit_price: 22, qty: 1, vat_rate: 10 }, // food
      { unit_price: 12.2, qty: 1, vat_rate: 22 }, // amaro da banco
    ];
    const v = vatBreakdown({}, lines);
    expect(v).toHaveLength(2);
    expect(v[0]).toEqual({ rate: 10, gross: 22, net: 20, tax: 2 });
    expect(v[1]).toEqual({ rate: 22, gross: 12.2, net: 10, tax: 2.2 });
  });

  it("defaults missing rates to 10 and folds the coperto into the same rate", () => {
    const v = vatBreakdown({ covers: 2, cover_unit: 1.5 }, [{ unit_price: 30, qty: 1 }]);
    expect(v).toHaveLength(1);
    expect(v[0].rate).toBe(10);
    expect(v[0].gross).toBe(33);
    expect(v[0].net).toBe(30);
    expect(v[0].tax).toBe(3);
  });

  it("ignores cancelled lines and returns [] on a zero bill", () => {
    expect(vatBreakdown({}, [{ unit_price: 10, qty: 1, status: "cancelled", vat_rate: 10 }])).toEqual([]);
    expect(vatBreakdown({}, [])).toEqual([]);
  });

  it("spreads a discount proportionally and the rows still sum to the bill total", () => {
    const order = { discount_type: "percent", discount_value: 10 };
    const lines = [
      { unit_price: 20, qty: 1, vat_rate: 10 },
      { unit_price: 10, qty: 1, vat_rate: 22 },
    ];
    const totals = computeTotals(order, lines);
    const v = vatBreakdown(order, lines);
    const grossSum = v.reduce((s, r) => s + toCents(r.gross), 0);
    expect(grossSum).toBe(toCents(totals.total)); // 27.00 €
    for (const r of v) {
      expect(toCents(r.net) + toCents(r.tax)).toBe(toCents(r.gross));
    }
  });

  it("keeps the sum exact when the discount doesn't divide evenly", () => {
    const order = { discount_type: "amount", discount_value: 0.05 };
    const lines = [
      { unit_price: 10, qty: 1, vat_rate: 10 },
      { unit_price: 10, qty: 1, vat_rate: 22 },
      { unit_price: 10, qty: 1, vat_rate: 4 },
    ];
    const totals = computeTotals(order, lines);
    const v = vatBreakdown(order, lines);
    expect(v.map((r) => r.rate)).toEqual([4, 10, 22]); // ascending
    const grossSum = v.reduce((s, r) => s + toCents(r.gross), 0);
    expect(grossSum).toBe(toCents(totals.total));
  });
});

describe("comandaStations", () => {
  it("groups active lines per reparto with the station-less group last", () => {
    const lines = [
      { unit_price: 5, qty: 1, station: "bar" },
      { unit_price: 12, qty: 1, station: null },
      { unit_price: 9, qty: 1, station: "cucina" },
      { unit_price: 4, qty: 2, station: "bar" },
      { unit_price: 7, qty: 1, station: "cucina", status: "cancelled" },
    ];
    const groups = comandaStations(lines);
    expect(groups.map((g) => g.station)).toEqual(["bar", "cucina", null]);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[1].lines).toHaveLength(1);
    expect(groups[2].lines).toHaveLength(1);
  });

  it("treats blank stations as none", () => {
    const groups = comandaStations([{ unit_price: 5, qty: 1, station: "  " }]);
    expect(groups).toEqual([{ station: null, lines: [{ unit_price: 5, qty: 1, station: "  " }] }]);
  });
});
