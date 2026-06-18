import { describe, it, expect } from "vitest";
import { weightedAvgCost, costTrend } from "@/lib/management/costing";

describe("weightedAvgCost", () => {
  it("weights cost by quantity", () => {
    // 10 @ €1 + 5 @ €1.50 = €17.50 / 15 = €1.1667
    expect(weightedAvgCost([{ qty: 10, unitCost: 1 }, { qty: 5, unitCost: 1.5 }])).toBe(1.1667);
  });
  it("ignores non-positive quantities and returns null with no weight", () => {
    expect(weightedAvgCost([{ qty: 0, unitCost: 5 }])).toBeNull();
    expect(weightedAvgCost([])).toBeNull();
  });
});

describe("costTrend", () => {
  it("sorts by date and computes change between first and last", () => {
    const t = costTrend([
      { observedOn: "2026-06-10", unitCost: 1.2 },
      { observedOn: "2026-06-01", unitCost: 1.0 },
    ]);
    expect(t.first).toBe(1);
    expect(t.last).toBe(1.2);
    expect(t.changePct).toBe(20);
    expect(t.points[0].observedOn).toBe("2026-06-01");
  });
  it("null change with a single point or zero base", () => {
    expect(costTrend([{ observedOn: "2026-06-01", unitCost: 2 }]).changePct).toBeNull();
    expect(costTrend([{ observedOn: "2026-06-01", unitCost: 0 }, { observedOn: "2026-06-02", unitCost: 1 }]).changePct).toBeNull();
  });
});
