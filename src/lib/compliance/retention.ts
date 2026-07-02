// Retention planning — data minimization over time. GDPR/revFADP both require we
// don't keep personal data longer than needed. Closed conversation transcripts are
// the clear target: they're free-text PII with no accounting value (unlike
// reservations, which are business records kept until tenant purge). This module
// computes WHAT each tenant's retention job should delete; the cron
// (/api/cron/data-retention) executes it.
//
// Safe by default: a tenant is only in the plan if it has EXPLICITLY opted into a
// retention policy (a configured country or a positive retention_days) — see
// isRetentionEnabled(). A tenant with no compliance config is never touched, so
// turning this on can't surprise-delete anyone's history.

import type { TenantSettings } from "@/lib/types/tenant-settings";
import { getComplianceConfig, isRetentionEnabled } from "./regions";

export interface RetentionPlanEntry {
  tenant_id: string;
  /** Effective retention window in days. */
  retention_days: number;
  /** ISO instant; conversation transcripts created strictly before this are due. */
  cutoff: string;
  /** The market that drove the policy (null when only retention_days was set). */
  country: string | null;
}

/** Minimal tenant shape the planner needs (id + settings). */
export interface RetentionTenant {
  id: string;
  settings?: TenantSettings | null;
}

/** The ISO cutoff instant: `now` minus `days` days. */
export function retentionCutoff(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/**
 * PURE: build the retention plan for a set of tenants. Only tenants that opted in
 * (isRetentionEnabled) appear; each entry carries the cutoff the cron deletes
 * transcripts before. A non-positive/insane retention window is skipped defensively.
 */
export function planRetention(tenants: RetentionTenant[], now: Date): RetentionPlanEntry[] {
  const plan: RetentionPlanEntry[] = [];
  for (const t of tenants || []) {
    if (!t?.id) continue;
    if (!isRetentionEnabled(t.settings)) continue;
    const cfg = getComplianceConfig(t.settings);
    if (!(cfg.retentionDays > 0)) continue;
    plan.push({
      tenant_id: t.id,
      retention_days: cfg.retentionDays,
      cutoff: retentionCutoff(now, cfg.retentionDays),
      country: cfg.country,
    });
  }
  return plan;
}
