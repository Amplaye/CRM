import { describe, it, expect } from "vitest";
import { planRetention, retentionCutoff } from "./retention";

describe("retentionCutoff", () => {
  it("subtracts the window in days", () => {
    const now = new Date("2026-07-02T00:00:00.000Z");
    expect(retentionCutoff(now, 30)).toBe("2026-06-02T00:00:00.000Z");
  });
});

describe("planRetention", () => {
  const now = new Date("2026-07-02T00:00:00.000Z");

  it("includes only opted-in tenants and uses their effective window", () => {
    const plan = planRetention(
      [
        { id: "a", settings: { compliance: { country: "IT" } } },            // region default 30
        { id: "b", settings: { compliance: { retention_days: 90 } } },       // override, no country
        { id: "c", settings: {} },                                            // NOT opted in
        { id: "d", settings: null },                                          // NOT opted in
        { id: "e", settings: { compliance: { country: "ES", retention_days: 7 } } },
      ],
      now,
    );
    const ids = plan.map((p) => p.tenant_id).sort();
    expect(ids).toEqual(["a", "b", "e"]);

    const a = plan.find((p) => p.tenant_id === "a")!;
    expect(a.retention_days).toBe(30);
    expect(a.country).toBe("IT");
    expect(a.cutoff).toBe(retentionCutoff(now, 30));

    const b = plan.find((p) => p.tenant_id === "b")!;
    expect(b.retention_days).toBe(90);
    expect(b.country).toBe(null);

    const e = plan.find((p) => p.tenant_id === "e")!;
    expect(e.retention_days).toBe(7);
  });

  it("skips tenants with no id and tolerates an empty list", () => {
    expect(planRetention([], now)).toEqual([]);
    expect(planRetention([{ id: "", settings: { compliance: { country: "IT" } } }], now)).toEqual([]);
  });
});
