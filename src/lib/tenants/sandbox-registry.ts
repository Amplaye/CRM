// Sandbox tenant registry — the CRM's side of the KV `sandbox:tenants` list the
// bot-engine Worker's RouterDO reads to build the "which restaurant?" menu on the
// shared sandbox WhatsApp number.
//
// This replaces what the [Meta Router] n8n workflow used to do implicitly (every
// cloned tenant appeared in its per-tenant routing). The Worker is dynamic, so a
// tenant is reachable on the sandbox number ONLY if it's in this KV list — during
// the demo phase every routable test tenant must be added at onboarding and
// removed at teardown. Both go through the Worker's internal endpoint (auth:
// CRON_SECRET, shared CRM↔Worker), never a direct KV binding (the CRM has none).
//
// Non-fatal by design: a sandbox-registry hiccup must not fail onboarding/teardown
// of the tenant itself (the DB/Supabase state is the source of truth). Callers get
// a boolean and log it; they don't throw on our behalf.

import { CLOUDFLARE_ENGINE_BASE_URL } from "@/lib/tenants/engine-health";

const SANDBOX_TENANTS_URL = `${CLOUDFLARE_ENGINE_BASE_URL}/internal/sandbox-tenants`;

async function mutateSandbox(body: Record<string, unknown>): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail-soft: no secret → can't reach the Worker
  try {
    const res = await fetch(SANDBOX_TENANTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Add (or upsert the name of) a tenant in the sandbox routing list. */
export function addSandboxTenant(tenantId: string, name: string): Promise<boolean> {
  return mutateSandbox({ action: "add", tenant_id: tenantId, name });
}

/** Remove a tenant from the sandbox routing list (idempotent no-op if absent). */
export function removeSandboxTenant(tenantId: string): Promise<boolean> {
  return mutateSandbox({ action: "remove", tenant_id: tenantId });
}
