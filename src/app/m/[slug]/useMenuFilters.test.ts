// The menu-filter behaviour worth pinning down: which tag chips get offered,
// and what the OR-matching actually admits.
//
// The hooks themselves need a DOM to render, and this suite runs on the `node`
// environment — so the pure helpers the hooks are built on are exported and
// tested directly. That's where the logic (and the regressions) actually live;
// the hook wrappers around them are trivial useState/useMemo plumbing.

import { describe, it, expect } from "vitest";
import { collectTags, tagMatches, FADE_MS } from "./useMenuFilters";

const sections = (...groups: string[][][]) =>
  groups.map((items, i) => ({
    key: `s${i}`,
    items: items.map((tags) => ({ tags })),
  }));

describe("collectTags", () => {
  it("offers only tags the menu actually uses, in first-appearance order", () => {
    expect(
      collectTags(sections([["Piccante"], ["Vegano", "Piccante"]], [["Vegano"]])),
    ).toEqual(["Piccante", "Vegano"]);
  });

  it("offers nothing when no dish is tagged, so the filter bar stays hidden", () => {
    expect(collectTags(sections([[], []], [[]]))).toEqual([]);
  });

  it("never repeats a tag shared across categories", () => {
    expect(collectTags(sections([["Vegano"]], [["Vegano"]], [["Vegano"]]))).toEqual([
      "Vegano",
    ]);
  });

  it("skips empty labels rather than offering a blank chip", () => {
    expect(collectTags(sections([["", "Vegano"]]))).toEqual(["Vegano"]);
  });
});

describe("tagMatches", () => {
  it("admits every dish while no tag is selected", () => {
    expect(tagMatches([], [])).toBe(true);
    expect(tagMatches([], ["Vegano"])).toBe(true);
  });

  it("ORs multiple tags rather than ANDing them", () => {
    const active = ["Vegano", "Piccante"];
    // A dish carrying EITHER tag survives — an AND would reject both of these.
    expect(tagMatches(active, ["Vegano"])).toBe(true);
    expect(tagMatches(active, ["Piccante"])).toBe(true);
    expect(tagMatches(active, ["Vegano", "Piccante"])).toBe(true);
    expect(tagMatches(active, ["Dolce"])).toBe(false);
  });

  it("rejects an untagged dish once any filter is on", () => {
    expect(tagMatches(["Vegano"], [])).toBe(false);
  });
});

describe("FADE_MS", () => {
  it("stays in step with the templates' .is-out CSS transition (180ms)", () => {
    // The crossfade is split across JS (this timer) and CSS (the transition on
    // each template's .is-out class). If they drift, the swap flashes the old
    // panel — so the constant is pinned here deliberately.
    expect(FADE_MS).toBe(180);
  });
});
