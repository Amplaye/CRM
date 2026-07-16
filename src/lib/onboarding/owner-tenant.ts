// The "controllo ferreo" for self-serve provisioning.
//
// When we open the provisioning endpoint to restaurant owners (previously
// platform_admin only), the one invariant that must never break is: an owner
// can provision ONLY a tenant they own. This pure resolver is the single place
// that decides which tenant id a request is allowed to provision, given the
// caller's own memberships. The endpoint derives the answer from here and NEVER
// trusts a tenant id from the request body unless it is proven to be the
// caller's own owner tenant.

export interface Membership {
  tenant_id: string;
  role: string;
}

export type OwnerTenantResult =
  | { ok: true; tenantId: string }
  | { ok: false; reason: "no_owner_tenant" | "forbidden_tenant" | "ambiguous_tenant" };

/**
 * Decide which tenant the caller may provision.
 *
 * @param memberships  every tenant_members row for the authenticated user
 * @param requested    optional tenant_id sent by the client (defence-in-depth:
 *                      even if present, it must match an owned tenant)
 */
export function resolveOwnerProvisionTenant(
  memberships: Membership[],
  requested?: string | null
): OwnerTenantResult {
  const owned = memberships.filter((m) => m.role === "owner").map((m) => m.tenant_id);

  if (owned.length === 0) return { ok: false, reason: "no_owner_tenant" };

  if (requested) {
    // Client named a tenant — it MUST be one the caller owns. This is what
    // stops an owner of A from provisioning B by passing B's id.
    return owned.includes(requested)
      ? { ok: true, tenantId: requested }
      : { ok: false, reason: "forbidden_tenant" };
  }

  // No tenant named: only safe if the caller owns exactly one.
  if (owned.length === 1) return { ok: true, tenantId: owned[0] };
  return { ok: false, reason: "ambiguous_tenant" };
}
