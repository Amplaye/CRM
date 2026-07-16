import { describe, it, expect } from "vitest";
import { reservationsForShift, canAddZones } from "./feature-logic";
import { getShift } from "../restaurant-rules";

// Proves the ON/OFF EFFECT of the two floor-screen flags (not just that the
// flag value is read — that's covered by tenant-settings.test.ts). Companion to
// docs/PIANO_SAAS.md Mossa 3 "config not code".

describe("double_shift flag → reservationsForShift", () => {
  const res = [
    { id: "a", time: "13:00" },                  // lunch (by time)
    { id: "b", time: "21:00" },                  // dinner (by time)
    { id: "c", time: "14:30" },                  // lunch (by time)
    { id: "d", shift: "dinner", time: "12:00" }, // explicit shift overrides time
  ];

  it("OFF → returns ALL reservations together, hides nothing (single service)", () => {
    expect(reservationsForShift(res, false, "lunch", getShift)).toHaveLength(4);
    expect(reservationsForShift(res, false, "dinner", getShift)).toHaveLength(4);
  });

  it("ON → only the selected shift's reservations", () => {
    expect(reservationsForShift(res, true, "lunch", getShift).map((r) => r.id)).toEqual(["a", "c"]);
    expect(reservationsForShift(res, true, "dinner", getShift).map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("ON → an explicit shift wins over the time-derived one", () => {
    // 'd' is at 12:00 (would be lunch by time) but tagged dinner → shows in dinner only
    expect(reservationsForShift(res, true, "lunch", getShift).map((r) => r.id)).not.toContain("d");
    expect(reservationsForShift(res, true, "dinner", getShift).map((r) => r.id)).toContain("d");
  });
});

describe("multi_room flag → canAddZones", () => {
  it("ON → owner can create new zones", () => {
    expect(canAddZones(true, 0)).toBe(true);
    expect(canAddZones(true, 1)).toBe(true);
  });

  it("OFF → cannot create new zones, whatever the zone count", () => {
    expect(canAddZones(false, 0)).toBe(false);
    expect(canAddZones(false, 1)).toBe(false);
    // Even with zones already built: the "+ add zone" button is hidden. Existing
    // zones stay visible/deletable on the floor screen (not gated here).
    expect(canAddZones(false, 2)).toBe(false);
    expect(canAddZones(false, 5)).toBe(false);
  });
});
