/**
 * Tenant lifecycle status — the SaaS gate.
 *
 * One source of truth, read by the CRM app, the admin UI, and (in future) the
 * shared engine. Mirrors the `tenants.status` column + check constraint in
 * supabase-schema.sql.
 *
 *   pending   — registered but not yet provisioned (no bot). No traffic.
 *   trial     — live, evaluating. Receives traffic.
 *   active    — live, paying. Receives traffic.
 *   suspended — turned off (non-payment / abuse). No traffic.
 *   archived  — soft-removed via offboarding; hidden, no traffic, purged after a
 *               grace period. Set ONLY by the archive flow, never the dropdown.
 *
 * The gate is enforced in src/app/api/webhooks/route.ts: a tenant that does not
 * receive traffic cannot consume AI/conversation work.
 */
export type TenantStatus = "pending" | "trial" | "active" | "suspended" | "archived";

/** Statuses that may receive AI traffic (and therefore consume). */
export const TRAFFIC_ALLOWED_STATUSES: readonly TenantStatus[] = ["trial", "active"];

/** True when the tenant is allowed to receive/consume AI traffic. */
export function tenantReceivesTraffic(status: TenantStatus | null | undefined): boolean {
  return !!status && TRAFFIC_ALLOWED_STATUSES.includes(status);
}

/** Ordered list for UI dropdowns/badges (label kept short & plain). */
export const TENANT_STATUSES: { value: TenantStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  // 'archived' is intentionally absent — set only via the tenant offboarding flow.
];

export function isTenantStatus(v: unknown): v is TenantStatus {
  return v === "pending" || v === "trial" || v === "active" || v === "suspended" || v === "archived";
}

/** Statuses an admin may set via the status dropdown — excludes 'archived',
 * which is reachable only through the protected archive/restore flow. */
export function isAdminSettableStatus(v: unknown): v is TenantStatus {
  return isTenantStatus(v) && v !== "archived";
}
