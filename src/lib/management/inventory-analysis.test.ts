import { describe, it, expect } from "vitest";
import { reorderList, consumptionVariance } from "@/lib/management/inventory-analysis";

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
