// Self-healing reconciliation for the Cloudflare sandbox routing list.
//
// History: this job used to backfill settings.provisioning.sandbox_routable for
// tenants left "active but unmarked" by a partial onboarding run that cloned the
// n8n workflows but died before the final settings commit. That failure mode is
// GONE: n8n is shut down (nothing to clone), and the orchestrator writes the
// routability markers EARLY (at row creation), so a truncated run can't strand a
// tenant without them.
//
// The residual gap on Cloudflare is different: a tenant can be active +
// sandbox_routable in the DB yet MISSING from the Worker's KV `sandbox:tenants`
// list — e.g. onboarding ran while the Worker was briefly unreachable, so
// addSandboxTenant() failed non-fatally, or a historical row predates the KV. Such
// a tenant is invisible in the shared "which restaurant?" menu. This job re-adds
// every active + sandbox_routable tenant to the KV list (idempotent upsert), so
// the menu can't silently drift out of sync with the DB.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { addSandboxTenant } from "@/lib/tenants/sandbox-registry";

export interface Repair {
  tenant_id: string;
  name: string;
  reason: string;
  added: Record<string, unknown>;
}

export interface ReconcileResult {
  dryRun: boolean;
  scanned: number;
  repaired: number;
  repairs: Repair[];
  skipped: { name: string; why: string }[];
}

export async function reconcileProvisioning(dryRun: boolean): Promise<ReconcileResult> {
  const supabase = createServiceRoleClient();
  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, name, status, settings")
    .eq("status", "active");
  if (error) throw new Error(error.message);

  const repairs: Repair[] = [];
  const skipped: { name: string; why: string }[] = [];

  for (const t of tenants || []) {
    const s = (t.settings || {}) as Record<string, unknown>;
    const prov = (s.provisioning || {}) as Record<string, unknown>;

    // A real customer on their own number isn't in the shared sandbox menu.
    if (prov.whatsapp_attached === true) {
      skipped.push({ name: t.name, why: "own number — not in shared sandbox menu" });
      continue;
    }
    // Only sandbox test tenants belong in the KV routing list.
    if (prov.sandbox_routable !== true) {
      skipped.push({ name: t.name, why: "not sandbox_routable — nothing to register" });
      continue;
    }

    const repair: Repair = {
      tenant_id: t.id,
      name: t.name,
      reason: "active + sandbox_routable — ensured present in KV sandbox routing list",
      added: { sandbox_tenant: { tenant_id: t.id, name: t.name } },
    };

    if (!dryRun) {
      const ok = await addSandboxTenant(t.id, t.name);
      if (!ok) {
        // Surface the failure rather than silently swallowing it.
        skipped.push({ name: t.name, why: "sandbox registry unreachable (Worker down / no CRON_SECRET)" });
        continue;
      }
    }
    repairs.push(repair);
  }

  return { dryRun, scanned: (tenants || []).length, repaired: repairs.length, repairs, skipped };
}
