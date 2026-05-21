import { describe, it, expect } from "vitest";
import {
  tenantReceivesTraffic,
  isTenantStatus,
  TRAFFIC_ALLOWED_STATUSES,
  TENANT_STATUSES,
} from "./status";

describe("tenantReceivesTraffic", () => {
  it("allows live tenants (trial, active)", () => {
    expect(tenantReceivesTraffic("trial")).toBe(true);
    expect(tenantReceivesTraffic("active")).toBe(true);
  });

  it("blocks non-live tenants (pending, suspended)", () => {
    expect(tenantReceivesTraffic("pending")).toBe(false);
    expect(tenantReceivesTraffic("suspended")).toBe(false);
  });

  it("blocks unknown / missing status (fails closed)", () => {
    expect(tenantReceivesTraffic(null)).toBe(false);
    expect(tenantReceivesTraffic(undefined)).toBe(false);
    expect(tenantReceivesTraffic("garbage" as any)).toBe(false);
  });

  it("traffic-allowed set is exactly trial+active", () => {
    expect([...TRAFFIC_ALLOWED_STATUSES].sort()).toEqual(["active", "trial"]);
  });
});

describe("isTenantStatus", () => {
  it("accepts the four known statuses", () => {
    expect(isTenantStatus("pending")).toBe(true);
    expect(isTenantStatus("trial")).toBe(true);
    expect(isTenantStatus("active")).toBe(true);
    expect(isTenantStatus("suspended")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isTenantStatus("paused")).toBe(false);
    expect(isTenantStatus("")).toBe(false);
    expect(isTenantStatus(undefined)).toBe(false);
    expect(isTenantStatus(3)).toBe(false);
  });

  it("UI list covers exactly the four statuses", () => {
    expect(TENANT_STATUSES.map((s) => s.value).sort()).toEqual([
      "active",
      "pending",
      "suspended",
      "trial",
    ]);
  });
});
