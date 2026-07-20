import { describe, it, expect } from "vitest";
import { addDaysIso, deriveExpiry } from "./expiry";

describe("addDaysIso", () => {
  it("adds days to an ISO date", () => {
    expect(addDaysIso("2026-07-20", 5)).toBe("2026-07-25");
  });
  it("rolls over month and year boundaries", () => {
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
  });
  it("accepts a Date base", () => {
    expect(addDaysIso(new Date("2026-07-20T00:00:00"), 10)).toBe("2026-07-30");
  });
});

describe("deriveExpiry", () => {
  it("returns base + shelf life when set", () => {
    expect(deriveExpiry("2026-07-20", 7)).toBe("2026-07-27");
  });
  it("returns null for missing or non-positive shelf life", () => {
    expect(deriveExpiry("2026-07-20", null)).toBeNull();
    expect(deriveExpiry("2026-07-20", undefined)).toBeNull();
    expect(deriveExpiry("2026-07-20", 0)).toBeNull();
    expect(deriveExpiry("2026-07-20", -3)).toBeNull();
  });
  it("rounds fractional shelf life", () => {
    expect(deriveExpiry("2026-07-20", 6.6)).toBe("2026-07-27");
  });
});
