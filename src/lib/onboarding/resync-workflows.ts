import { createServiceRoleClient } from "@/lib/supabase/server";
import { resyncContactTokens, toCreatePayload, type ContactResync } from "./substitute";
import { n8n, updateWorkflow, activateWorkflow } from "./n8n-client";

// The SHARED motore unico ([Picnic] Chatbot WhatsApp). It is the ONE workflow
// every tenant runs in common, and it reads its config (responsible_phone etc.)
// LIVE from the DB — its contacts are NOT baked in. Patching it would corrupt
// the engine for every tenant, so the re-sync excludes it explicitly even
// though its id sits in each tenant's workflow_ids list.
export const SHARED_MOTORE_WORKFLOW_ID = "166QnQsGHqXDpBxa";

export interface ResyncSummary {
  checked: number;            // workflows fetched + scanned
  changed: number;            // workflows whose JSON actually changed
  changedIds: string[];       // ids of the changed workflows (PUT, unless dryRun)
  failed: Array<{ id: string; error: string }>;
  skippedMotore: boolean;     // the shared motore was present and skipped
  dryRun: boolean;
}

// Re-sync the baked contact tokens (owner_phone, restaurant_phone, review_url)
// across a tenant's per-tenant cloned auxiliary workflows. Pure find-and-replace
// IN PLACE (PUT preserves ids + webhook paths). Best-effort per workflow: one
// failure is recorded and the rest continue.
//
// ARCHITECTURAL NOTE: this is the pragmatic patch while those auxiliary
// workflows still bake the values at clone time. The definitive fix is to make
// them read the values LIVE from the DB (as the shared motore already does) and
// delete the baking + this re-sync. See substitute.ts / the sync route.
export async function resyncTenantWorkflows(
  tenantId: string,
  sub: ContactResync,
  opts?: { dryRun?: boolean },
): Promise<ResyncSummary> {
  const dryRun = !!opts?.dryRun;
  const summary: ResyncSummary = {
    checked: 0, changed: 0, changedIds: [], failed: [], skippedMotore: false, dryRun,
  };

  const supabase = createServiceRoleClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .single();

  const allIds: string[] = ((tenant?.settings as any)?.n8n?.workflow_ids || [])
    .filter((x: unknown): x is string => typeof x === "string");

  // Only ever touch ids the tenant actually owns, and NEVER the shared motore.
  const targets = allIds.filter((id) => {
    if (id === SHARED_MOTORE_WORKFLOW_ID) { summary.skippedMotore = true; return false; }
    return true;
  });
  if (targets.length === 0) return summary;

  for (const wid of targets) {
    try {
      const wf = await n8n("GET", `/workflows/${wid}`);
      // CRITICAL: preserve the workflow's prior active state. A tenant's
      // workflow_ids can include DELIBERATELY-DISABLED clones — e.g. its old
      // per-tenant "[X] Chatbot WhatsApp" that the shared motore unico replaced,
      // or a reminder flow the owner turned off. Re-activating those after a PUT
      // would resurrect a duplicate engine (double WhatsApp replies). We only
      // re-activate workflows that were ALREADY active before we touched them.
      const wasActive = wf?.active === true;
      const before = JSON.stringify(wf);
      const after = resyncContactTokens(before, sub);
      summary.checked++;
      if (after === before) continue; // nothing baked here matched — leave it

      summary.changed++;
      summary.changedIds.push(wid);
      if (dryRun) continue;

      const rewritten = JSON.parse(after);
      await updateWorkflow(wid, toCreatePayload(rewritten, rewritten.name || wf.name || "Workflow"));
      // n8n deactivates a workflow on PUT, so re-activate ONLY the ones that were
      // active — never enable a previously-disabled clone. Tolerate failures.
      if (wasActive) {
        try { await activateWorkflow(wid); } catch { /* tolerate */ }
      }
    } catch (e: any) {
      summary.failed.push({ id: wid, error: e?.message || String(e) });
    }
  }

  return summary;
}
