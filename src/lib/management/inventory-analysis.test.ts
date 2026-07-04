import { describe, it, expect } from "vitest";
import { reorderList, consumptionVariance, suggestParLevels, shrinkageSummary } from "@/lib/management/inventory-analysis";

describe("reorderList", () => {
  it("suggests topping up to coverage × par for items at/below par", () => {
    const lines = reorderList([
      { ingredientId: "a", name: "Flour", unit: "kg", stockQty: 2, parLevel: 5, unitCost: 1 }, // low
      { ingredientId: "b", name: "Salt", unit: "kg", stockQty: 9, parLevel: 5, unitCost: 1 }, // ok
      { ingredientId: "c", name: "Oil", unit: "l", stockQty: 0, parLevel: 3, unitCost: 4 }, // low
    ]);
    expect(lines.map((l) => l.ingredientId)).toEqual(["c", "a"]); // sorted by € desc
    const a = lines.find((l) => l.ingredientId === "a")!;
    expect(a.suggestedQty).toBe(8); // 5*2 - 2
    expect(a.estimatedCost).toBe(8);
    const c = lines.find((l) => l.ingredientId === "c")!;
    expect(c.suggestedQty).toBe(6); // 3*2 - 0
    expect(c.estimatedCost).toBe(24);
  });

  it("skips items with no par set", () => {
    expect(reorderList([{ ingredientId: "x", name: "X", unit: "kg", stockQty: 0, parLevel: 0, unitCost: 1 }])).toEqual([]);
  });
});

describe("consumptionVariance", () => {
  it("derives actual usage from the inventory identity and compares to theoretical", () => {
    // opening 100 + received 50 − counted 30 = actual 120; recipes said 100 → +20 loss
    const lines = consumptionVariance([
      { ingredientId: "a", name: "Flour", unit: "g", unitCost: 0.001, opening: 100, received: 50, counted: 30, theoretical: 100 },
    ]);
    expect(lines[0].actual).toBe(120);
    expect(lines[0].variance).toBe(20);
    expect(lines[0].variancePct).toBe(20);
    expect(lines[0].varianceCost).toBe(0.02);
  });

  it("sorts by absolute € impact and handles zero theoretical", () => {
    const lines = consumptionVariance([
      { ingredientId: "small", name: "S", unit: "g", unitCost: 1, opening: 0, received: 0, counted: 0, theoretical: 0 },
      { ingredientId: "big", name: "B", unit: "kg", unitCost: 10, opening: 10, received: 0, counted: 5, theoretical: 2 },
    ]);
    expect(lines[0].ingredientId).toBe("big"); // 3 * 10 = €30 impact
    const small = lines.find((l) => l.ingredientId === "small")!;
    expect(small.variancePct).toBeNull();
  });
});

const NOW = new Date("2026-07-04T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

describe("suggestParLevels", () => {
  it("suggests coverDays of average daily consumption from sales + waste", () => {
    const out = suggestParLevels(
      [
        { ingredientId: "a", qtyDelta: -30, kind: "sale", createdAt: daysAgo(30) },
        { ingredientId: "a", qtyDelta: -30, kind: "sale", createdAt: daysAgo(10) },
        { ingredientId: "a", qtyDelta: -30, kind: "waste", createdAt: daysAgo(1) },
        { ingredientId: "a", qtyDelta: +100, kind: "receipt", createdAt: daysAgo(5) }, // ignored
        { ingredientId: "b", qtyDelta: -5, kind: "count", createdAt: daysAgo(2) }, // corrections don't count
      ],
      { now: NOW, windowDays: 30, coverDays: 3 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].ingredientId).toBe("a");
    expect(out[0].avgDaily).toBe(3); // 90 over 30 days
    expect(out[0].suggestedPar).toBe(9);
  });

  it("adapts to young datasets instead of diluting over the full window", () => {
    // 20 units consumed but data only spans 4 days → avg 5/day, not 20/30
    const out = suggestParLevels(
      [
        { ingredientId: "a", qtyDelta: -10, kind: "sale", createdAt: daysAgo(4) },
        { ingredientId: "a", qtyDelta: -10, kind: "sale", createdAt: daysAgo(1) },
      ],
      { now: NOW, windowDays: 30, coverDays: 2 },
    );
    expect(out[0].avgDaily).toBe(5);
    expect(out[0].suggestedPar).toBe(10);
  });

  it("ignores movements outside the window and returns nothing without data", () => {
    expect(
      suggestParLevels([{ ingredientId: "a", qtyDelta: -50, kind: "sale", createdAt: daysAgo(45) }], { now: NOW }),
    ).toEqual([]);
    expect(suggestParLevels([], { now: NOW })).toEqual([]);
  });
});

describe("shrinkageSummary", () => {
  const ings = [
    { id: "a", name: "Salmone", unit: "kg", unitCost: 20 },
    { id: "b", name: "Farina", unit: "kg", unitCost: 1 },
  ];

  it("nets waste + count corrections + adjustments, valued at unit cost, worst first", () => {
    const s = shrinkageSummary(
      [
        { ingredientId: "a", qtyDelta: -2, kind: "waste", createdAt: daysAgo(3) },
        { ingredientId: "a", qtyDelta: -1, kind: "count", createdAt: daysAgo(2) },
        { ingredientId: "b", qtyDelta: -4, kind: "adjustment", createdAt: daysAgo(1) },
        { ingredientId: "b", qtyDelta: -100, kind: "sale", createdAt: daysAgo(1) }, // expected flow, excluded
      ],
      ings,
      { now: NOW, windowDays: 30 },
    );
    expect(s.lines.map((l) => l.ingredientId)).toEqual(["a", "b"]); // −€60 before −€4
    expect(s.lines[0].cost).toBe(-60);
    expect(s.totalCost).toBe(-64);
  });

  it("drops net-zero lines and unknown ingredients", () => {
    const s = shrinkageSummary(
      [
        { ingredientId: "a", qtyDelta: -2, kind: "waste", createdAt: daysAgo(3) },
        { ingredientId: "a", qtyDelta: +2, kind: "count", createdAt: daysAgo(2) },
        { ingredientId: "ghost", qtyDelta: -9, kind: "waste", createdAt: daysAgo(2) },
      ],
      ings,
      { now: NOW },
    );
    expect(s.lines).toEqual([]);
    expect(s.totalCost).toBe(0);
  });
});
