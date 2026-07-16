import { describe, expect, it } from "vitest";
import { DEFAULT_LOYALTY, getLoyaltyConfig } from "./loyalty";

describe("getLoyaltyConfig", () => {
  it("returns defaults when settings are empty", () => {
    expect(getLoyaltyConfig(undefined)).toEqual(DEFAULT_LOYALTY);
    expect(getLoyaltyConfig({})).toEqual(DEFAULT_LOYALTY);
  });

  it("reads a full config", () => {
    expect(
      getLoyaltyConfig({ loyalty: { points_per_visit: 5, reward_points: 50, reward_label: "Dessert" } }),
    ).toEqual({ points_per_visit: 5, reward_points: 50, reward_label: "Dessert" });
  });

  it("clamps zero/negative/garbage back to defaults", () => {
    const cfg = getLoyaltyConfig({
      loyalty: { points_per_visit: 0, reward_points: -3, reward_label: 42 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(cfg.points_per_visit).toBe(DEFAULT_LOYALTY.points_per_visit);
    expect(cfg.reward_points).toBe(DEFAULT_LOYALTY.reward_points);
    expect(cfg.reward_label).toBe("");
  });

  it("rounds fractional point values", () => {
    const cfg = getLoyaltyConfig({ loyalty: { points_per_visit: 2.6, reward_points: 99.2 } });
    expect(cfg.points_per_visit).toBe(3);
    expect(cfg.reward_points).toBe(99);
  });
});
