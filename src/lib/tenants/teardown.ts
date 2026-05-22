// Tenant teardown helpers.
//
// The selection logic (which workflows to kill, which voice provider, which
// staff, which bot_sessions) is PURE and unit-tested in teardown.test.ts — it is
// the part that, if wrong, would touch the wrong tenant. The thin network
// wrappers below it are integration-tested live (see the offboarding plan run).
import type { TenantSettings } from "@/lib/types/tenant-settings";
import { deleteAssistant } from "@/lib/onboarding/vapi";

// --- Pure selection helpers ----------------------------------------------------

/** Workflow ids to remove for a tenant: the stored ids ∪ any whose name starts
 * with "[<tenantName>]". Legacy tenants tracked no ids, so the name prefix is
 * the safety net; new tenants store ids, so we cover both and de-dupe. */
export function n8nWorkflowIdsToRemove(
  allWorkflows: Array<{ id: string; name: string }>,
  tenantName: string,
  storedIds: string[] = []
): string[] {
  const prefix = `[${tenantName}]`;
  const byName = allWorkflows.filter((w) => (w.name || "").startsWith(prefix)).map((w) => w.id);
  return Array.from(new Set([...storedIds, ...byName]));
}

export type VoiceProvider = "vapi" | "retell" | "none";
export interface VoiceTeardownPlan {
  provider: VoiceProvider;
  vapiAssistantId?: string;
  retellAgentId?: string;
  retellLlmId?: string;
  retellKbId?: string;
}

/** Detect which voice provider a tenant uses and what to delete. */
export function voiceTeardownPlan(settings: TenantSettings | null | undefined): VoiceTeardownPlan {
  const s = (settings || {}) as any;
  if (s.vapi?.assistantId) return { provider: "vapi", vapiAssistantId: s.vapi.assistantId };
  if (s.retell?.agentId) {
    return {
      provider: "retell",
      retellAgentId: s.retell.agentId,
      retellLlmId: s.retell.llmId,
      retellKbId: s.retell_kb?.id,
    };
  }
  return { provider: "none" };
}

export interface StaffMember {
  user_id: string;
  email: string;
  global_role: string | null;
  /** memberships this user has in OTHER tenants. */
  otherTenantCount: number;
}
export interface StaffPlan {
  delete: string[];
  ban: string[];
  skip: string[];
}

/** Classify a tenant's staff for login teardown. NEVER touch platform_admins or
 * users that belong to another tenant. Synthetic QR-staff (@baliflow.local) are
 * deleted (they exist only for this tenant); real single-tenant staff are banned
 * (login disabled, reversible). */
export function classifyStaffForTeardown(members: StaffMember[]): StaffPlan {
  const plan: StaffPlan = { delete: [], ban: [], skip: [] };
  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m.user_id)) continue;
    seen.add(m.user_id);
    if (m.global_role === "platform_admin" || m.otherTenantCount > 0) {
      plan.skip.push(m.user_id);
      continue;
    }
    if (/@baliflow\.local$/i.test(m.email || "")) plan.delete.push(m.user_id);
    else plan.ban.push(m.user_id);
  }
  return plan;
}

/** Phones whose bot_sessions are safe to delete: this tenant's guest phones
 * minus any phone still used by another tenant's guest (bot_sessions is keyed by
 * phone, not tenant). */
export function botSessionPhonesToClean(thisTenantPhones: string[], otherTenantPhones: string[]): string[] {
  const others = new Set(otherTenantPhones);
  return Array.from(new Set(thisTenantPhones.filter((p) => p && !others.has(p))));
}

// --- n8n (self-hosted, /api/v1, X-N8N-API-KEY) ---------------------------------
const N8N_BASE = process.env.N8N_BASE_URL || "https://n8n.srv1468837.hstgr.cloud";

async function n8nFetch(method: string, path: string): Promise<Response> {
  const key = process.env.N8N_API_KEY;
  if (!key) throw new Error("N8N_API_KEY not configured");
  return fetch(`${N8N_BASE}/api/v1${path}`, {
    method,
    headers: { "X-N8N-API-KEY": key, "Content-Type": "application/json" },
  });
}

export async function listN8nWorkflows(): Promise<Array<{ id: string; name: string; active: boolean }>> {
  const res = await n8nFetch("GET", "/workflows?limit=250");
  if (!res.ok) throw new Error(`n8n list -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const rows = Array.isArray(j) ? j : j.data || [];
  return rows.map((w: any) => ({ id: w.id, name: w.name, active: !!w.active }));
}

export async function activateN8nWorkflow(id: string): Promise<void> {
  const res = await n8nFetch("POST", `/workflows/${id}/activate`);
  if (!res.ok && res.status !== 404) throw new Error(`n8n activate ${id} -> ${res.status}`);
}

export async function deactivateN8nWorkflow(id: string): Promise<void> {
  const res = await n8nFetch("POST", `/workflows/${id}/deactivate`);
  if (!res.ok && res.status !== 404) throw new Error(`n8n deactivate ${id} -> ${res.status}`);
}

export async function deleteN8nWorkflow(id: string): Promise<void> {
  // Deactivate first so no trigger fires mid-delete; then delete. 404 is success.
  await deactivateN8nWorkflow(id).catch(() => {});
  const res = await n8nFetch("DELETE", `/workflows/${id}`);
  if (!res.ok && res.status !== 404) throw new Error(`n8n delete ${id} -> ${res.status}`);
}

// --- Vapi (reuse onboarding helper) --------------------------------------------
export async function deleteVapiAssistant(assistantId: string): Promise<void> {
  const key = process.env.VAPI_PRIVATE_KEY;
  if (!key) throw new Error("VAPI_PRIVATE_KEY not configured");
  await deleteAssistant(assistantId, key); // already treats 404 as success
}

// --- Retell (legacy tenants) ---------------------------------------------------
const RETELL_BASE = "https://api.retellai.com";
function retellHeaders() {
  const key = process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY not configured");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function retellDelete(path: string, label: string): Promise<void> {
  const res = await fetch(`${RETELL_BASE}${path}`, { method: "DELETE", headers: retellHeaders() });
  if (!res.ok && res.status !== 404) {
    throw new Error(`retell ${label} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Delete a legacy tenant's Retell agent, its LLM, and its knowledge base. */
export async function deleteRetellVoice(plan: {
  retellAgentId?: string;
  retellLlmId?: string;
  retellKbId?: string;
}): Promise<void> {
  if (plan.retellAgentId) await retellDelete(`/delete-agent/${plan.retellAgentId}`, "delete-agent");
  if (plan.retellLlmId) await retellDelete(`/delete-retell-llm/${plan.retellLlmId}`, "delete-retell-llm");
  if (plan.retellKbId) await retellDelete(`/delete-knowledge-base/${plan.retellKbId}`, "delete-knowledge-base");
}
