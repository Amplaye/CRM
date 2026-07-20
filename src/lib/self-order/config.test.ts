import { describe, it, expect } from "vitest";
import {
  getSelfOrderConfig,
  foodUnlockAtMs,
  foodUnlocked,
  normalizeCooldownMin,
  FOOD_COOLDOWN_MIN,
  MAX_COOLDOWN_MIN,
} from "./config";

describe("getSelfOrderConfig", () => {
  it("defaults to no drink categories and the standard cooldown", () => {
    const c = getSelfOrderConfig(null);
    expect(c.drink_category_ids).toEqual([]);
    expect(c.cooldown_min).toBe(FOOD_COOLDOWN_MIN);
  });

  it("reads the owner's cooldown when set", () => {
    expect(getSelfOrderConfig({ self_order: { cooldown_min: 25 } } as any).cooldown_min).toBe(25);
  });

  it("keeps an explicit 0 (owner disabled the lock)", () => {
    // The distinction that matters: 0 is a real choice, absent is not.
    expect(getSelfOrderConfig({ self_order: { cooldown_min: 0 } } as any).cooldown_min).toBe(0);
  });

  it("falls back to the default — never to 0 — on a malformed cooldown", () => {
    // A broken setting must not silently switch the lock OFF.
    expect(getSelfOrderConfig({ self_order: { cooldown_min: "abc" } } as any).cooldown_min).toBe(
      FOOD_COOLDOWN_MIN,
    );
    expect(getSelfOrderConfig({ self_order: { cooldown_min: null } } as any).cooldown_min).toBe(
      FOOD_COOLDOWN_MIN,
    );
  });

  it("clamps an out-of-range cooldown", () => {
    expect(getSelfOrderConfig({ self_order: { cooldown_min: -5 } } as any).cooldown_min).toBe(0);
    expect(getSelfOrderConfig({ self_order: { cooldown_min: 999 } } as any).cooldown_min).toBe(
      MAX_COOLDOWN_MIN,
    );
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

describe("normalizeCooldownMin", () => {
  it("rounds to whole minutes and clamps to the allowed range", () => {
    expect(normalizeCooldownMin(12.4)).toBe(12);
    expect(normalizeCooldownMin(12.6)).toBe(13);
    expect(normalizeCooldownMin(-1)).toBe(0);
    expect(normalizeCooldownMin(10_000)).toBe(MAX_COOLDOWN_MIN);
  });

  it("accepts numeric strings (the settings form sends text)", () => {
    expect(normalizeCooldownMin("15")).toBe(15);
  });

  it("falls back to the default on junk", () => {
    expect(normalizeCooldownMin("")).toBe(FOOD_COOLDOWN_MIN);
    expect(normalizeCooldownMin(undefined)).toBe(FOOD_COOLDOWN_MIN);
    expect(normalizeCooldownMin(NaN)).toBe(FOOD_COOLDOWN_MIN);
  });
});

describe("food cooldown clock", () => {
  const opened = 1_000_000_000_000; // fixed anchor, ms

  it("unlocks exactly cooldown minutes after the bill opens", () => {
    expect(foodUnlockAtMs(opened, 10)).toBe(opened + 10 * 60_000);
    expect(foodUnlockAtMs(opened, 25)).toBe(opened + 25 * 60_000);
  });

  it("is locked before the unlock instant and open at/after it", () => {
    const unlock = foodUnlockAtMs(opened, FOOD_COOLDOWN_MIN);
    expect(foodUnlocked(opened, opened, FOOD_COOLDOWN_MIN)).toBe(false); // just opened
    expect(foodUnlocked(opened, unlock - 1, FOOD_COOLDOWN_MIN)).toBe(false); // one ms early
    expect(foodUnlocked(opened, unlock, FOOD_COOLDOWN_MIN)).toBe(true); // exactly on time
    expect(foodUnlocked(opened, unlock + 60_000, FOOD_COOLDOWN_MIN)).toBe(true); // later
  });

  it("a zero cooldown never locks anything", () => {
    expect(foodUnlocked(opened, opened, 0)).toBe(true);
  });

  it("honours a longer owner-set cooldown", () => {
    // Still locked at the old 10-minute mark when the owner asked for 30.
    expect(foodUnlocked(opened, opened + 10 * 60_000, 30)).toBe(false);
    expect(foodUnlocked(opened, opened + 30 * 60_000, 30)).toBe(true);
  });
});
