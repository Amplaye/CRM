import { describe, it, expect } from "vitest";
import { resolveOwnerProvisionTenant, Membership } from "./owner-tenant";

const own = (id: string): Membership => ({ tenant_id: id, role: "owner" });
const staff = (id: string): Membership => ({ tenant_id: id, role: "host" });

describe("resolveOwnerProvisionTenant — the controllo ferreo", () => {
  it("rejects a user who owns no tenant", () => {
    expect(resolveOwnerProvisionTenant([])).toEqual({ ok: false, reason: "no_owner_tenant" });
    expect(resolveOwnerProvisionTenant([staff("A")])).toEqual({ ok: false, reason: "no_owner_tenant" });
  });

  it("resolves the single owned tenant when none is requested", () => {
    expect(resolveOwnerProvisionTenant([own("A")])).toEqual({ ok: true, tenantId: "A" });
  });

  it("ALWAYS rejects provisioning a tenant the caller does not own", () => {
    // The attack: owner of A passes B's id. Must be forbidden.
    expect(resolveOwnerProvisionTenant([own("A")], "B")).toEqual({ ok: false, reason: "forbidden_tenant" });
    // Being a non-owner member of B is not enough either.
    expect(resolveOwnerProvisionTenant([own("A"), staff("B")], "B")).toEqual({ ok: false, reason: "forbidden_tenant" });
  });

  it("accepts a requested tenant only when it is one the caller owns", () => {
    expect(resolveOwnerProvisionTenant([own("A"), own("B")], "B")).toEqual({ ok: true, tenantId: "B" });
  });

  it("refuses to guess when the caller owns several and named none", () => {
    expect(resolveOwnerProvisionTenant([own("A"), own("B")])).toEqual({ ok: false, reason: "ambiguous_tenant" });
  });
});
