// Work-in-progress sections — a PRODUCT-level gate that sits ON TOP of billing.
// These dashboard sections are still being built, so they're hidden for every
// tenant EXCEPT an allowlist of early testers, no matter what plan or add-on the
// tenant has paid for (a tenant can own the gestionale add-on and still not see
// these until they leave WIP).
//
// To ship a section: delete its href from WIP_HREFS. Once nobody needs early
// access any more, empty WIP_TENANT_ALLOWLIST too and this whole gate is inert.

/** Dashboard hrefs gated as work-in-progress (gestionale: P&L, food cost).
 * /inventory shipped 2026-07-04 (automated inventory: invoice capture, auto par
 * levels, supplier orders, shrinkage) and left this gate. */
export const WIP_HREFS = new Set<string>(["/pl", "/food-cost"]);

/** Tenant ids allowed to use WIP sections while they're still being built. */
export const WIP_TENANT_ALLOWLIST = new Set<string>([
  "93eebe9c-8af5-4ca5-a315-3376ef4976e5", // Oraz — early tester for the gestionale
]);

/** Is this dashboard href currently gated as work-in-progress? */
export function isWipHref(href: string): boolean {
  return WIP_HREFS.has(href);
}

/** May this tenant use WIP sections (i.e. is it on the early-access allowlist)? */
export function canSeeWip(tenantId: string | null | undefined): boolean {
  return !!tenantId && WIP_TENANT_ALLOWLIST.has(tenantId);
}
