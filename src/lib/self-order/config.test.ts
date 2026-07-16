import { describe, it, expect } from "vitest";
import {
  getSelfOrderConfig,
  foodUnlockAtMs,
  foodUnlocked,
  FOOD_COOLDOWN_MIN,
} from "./config";

describe("getSelfOrderConfig", () => {
  it("defaults to no drink categories and the standard cooldown", () => {
    const c = getSelfOrderConfig(null);
    expect(c.drink_category_ids).toEqual([]);
    expect(c.cooldown_min).toBe(FOOD_COOLDOWN_MIN);
  });

  it("reads and de-dups drink category ids", () => {
    const c = getSelfOrderConfig({ self_order: { drink_category_ids: ["a", "b", "a"] } } as any);
    expect(c.drink_category_ids).toEqual(["a", "b"]);
  });

  it("drops non-string / empty ids from a hand-edited blob", () => {
    const c = getSelfOrderConfig({ self_order: { drink_category_ids: ["a", "", 3, null] } } as any);
    expect(c.drink_category_ids).toEqual(["a"]);
  });

  it("survives a malformed self_order value", () => {
    expect(getSelfOrderConfig({ self_order: "nope" } as any).drink_category_ids).toEqual([]);
    expect(getSelfOrderConfig({ self_order: { drink_category_ids: "x" } } as any).drink_category_ids).toEqual([]);
  });
});

describe("food cooldown clock", () => {
  const opened = 1_000_000_000_000; // fixed anchor, ms

  it("unlocks exactly cooldown minutes after the bill opens", () => {
    expect(foodUnlockAtMs(opened)).toBe(opened + FOOD_COOLDOWN_MIN * 60_000);
  });

  it("is locked before the unlock instant and open at/after it", () => {
    const unlock = foodUnlockAtMs(opened);
    expect(foodUnlocked(opened, opened)).toBe(false); // just opened
    expect(foodUnlocked(opened, unlock - 1)).toBe(false); // one ms early
    expect(foodUnlocked(opened, unlock)).toBe(true); // exactly on time
    expect(foodUnlocked(opened, unlock + 60_000)).toBe(true); // later
  });
});
