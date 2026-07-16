import { describe, it, expect } from "vitest";
import { buildTablesForCapacity } from "./orchestrator";

// buildTablesForCapacity turns the owner's declared seat count + terrace toggle
// into the starter floor plan. Two invariants matter:
//   1. The seat total equals the declared capacity exactly (Tables ↔ KB agree).
//   2. Zones reflect the wizard's terrace toggle — no terrace must NOT mint an
//      outside room ("sala esterna"), which was the reported bug.
describe("buildTablesForCapacity", () => {
  it("matches the declared seat total exactly", () => {
    for (const seats of [2, 7, 12, 25, 51, 120]) {
      const tables = buildTablesForCapacity("t1", seats, true);
      const total = tables.reduce((s, tb) => s + tb.seats, 0);
      expect(total).toBe(seats);
    }
  });

  it("puts every table inside when there is NO terrace", () => {
    const tables = buildTablesForCapacity("t1", 40, false);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((t) => t.zone === "inside")).toBe(true);
    expect(tables.some((t) => t.zone === "outside")).toBe(false);
  });

  it("splits inside/outside when there IS a terrace", () => {
    const tables = buildTablesForCapacity("t1", 40, true);
    expect(tables.some((t) => t.zone === "inside")).toBe(true);
    expect(tables.some((t) => t.zone === "outside")).toBe(true);
  });

  it("clamps an absurd capacity to the 300 upper bound", () => {
    // A typo of 99999 must not mint thousands of tables; it caps at 300 seats.
    expect(buildTablesForCapacity("t1", 99999, false).reduce((s, t) => s + t.seats, 0)).toBe(300);
    // A real small venue (2 seats) is honoured, not silently padded.
    expect(buildTablesForCapacity("t1", 2, false).reduce((s, t) => s + t.seats, 0)).toBe(2);
  });
});
