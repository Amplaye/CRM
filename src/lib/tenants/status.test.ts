import { describe, it, expect } from "vitest";
import {
  tenantReceivesTraffic,
  isTenantStatus,
  isAdminSettableStatus,
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

describe("archived status", () => {
  it("archived is a valid TenantStatus", () => {
    expect(isTenantStatus("archived")).toBe(true);
  });
  it("archived does NOT receive traffic", () => {
    expect(tenantReceivesTraffic("archived")).toBe(false);
  });
  it("archived is not offered in the admin status dropdown", () => {
    expect(TENANT_STATUSES.map((s) => s.value)).not.toContain("archived");
  });
  it("admin cannot set archived via the dropdown guard", () => {
    expect(isAdminSettableStatus("active")).toBe(true);
    expect(isAdminSettableStatus("archived")).toBe(false);
    expect(isAdminSettableStatus("garbage")).toBe(false);
  });
});
