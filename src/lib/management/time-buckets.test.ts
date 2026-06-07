import { describe, it, expect } from "vitest";
import { shiftOf } from "@/lib/management/time-buckets";

describe("shiftOf", () => {
  it("before 17:00 local is lunch, otherwise dinner (Europe/Rome)", () => {
    expect(shiftOf("2026-06-01T13:00:00+02:00", "Europe/Rome")).toBe("lunch");
    expect(shiftOf("2026-06-01T16:59:00+02:00", "Europe/Rome")).toBe("lunch");
    expect(shiftOf("2026-06-01T17:00:00+02:00", "Europe/Rome")).toBe("dinner");
    expect(shiftOf("2026-06-01T21:30:00+02:00", "Europe/Rome")).toBe("dinner");
  });
  it("reads the hour in the given timezone, not the server's", () => {
    // 23:30 UTC is 01:30 next day in Rome → lunch (early morning, < 17)
    expect(shiftOf("2026-06-01T23:30:00Z", "Europe/Rome")).toBe("lunch");
    // 18:00 UTC is 20:00 Rome → dinner
    expect(shiftOf("2026-06-01T18:00:00Z", "Europe/Rome")).toBe("dinner");
  });
});
