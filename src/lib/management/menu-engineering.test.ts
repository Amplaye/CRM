import { describe, it, expect } from "vitest";
import { menuEngineering } from "@/lib/management/menu-engineering";

describe("menuEngineering", () => {
  it("classifies dishes into the four quadrants", () => {
    const res = menuEngineering([
      { menuItemId: "a", name: "Star", margin: 10, unitsSold: 100 }, // high pop + high margin
      { menuItemId: "b", name: "Plowhorse", margin: 2, unitsSold: 100 }, // high pop + low margin
      { menuItemId: "c", name: "Puzzle", margin: 10, unitsSold: 5 }, // low pop + high margin
      { menuItemId: "d", name: "Dog", margin: 2, unitsSold: 5 }, // low pop + low margin
    ]);
    const klass = (id: string) => res.rows.find((r) => r.menuItemId === id)!.klass;
    expect(klass("a")).toBe("star");
    expect(klass("b")).toBe("plowhorse");
    expect(klass("c")).toBe("puzzle");
    expect(klass("d")).toBe("dog");
    expect(res.counts).toEqual({ star: 1, plowhorse: 1, puzzle: 1, dog: 1 });
    expect(res.avgMargin).toBe(6); // (10+2+10+2)/4
  });

  it("excludes dishes with an unknown margin", () => {
    const res = menuEngineering([
      { menuItemId: "a", name: "Priced", margin: 5, unitsSold: 10 },
      { menuItemId: "b", name: "No recipe", margin: null, unitsSold: 50 },
    ]);
    expect(res.rows.map((r) => r.menuItemId)).toEqual(["a"]);
  });

  it("sorts stars before puzzles, plowhorses and dogs", () => {
    const res = menuEngineering([
      { menuItemId: "dog", name: "Dog", margin: 1, unitsSold: 1 },
      { menuItemId: "star", name: "Star", margin: 10, unitsSold: 100 },
    ]);
    expect(res.rows[0].menuItemId).toBe("star");
  });
});
