// Tenant teardown helpers.
//
// The selection logic (which workflows to kill, which voice provider, which
// staff, which bot_sessions) is PURE and unit-tested in teardown.test.ts — it is
// the part that, if wrong, would touch the wrong tenant. The thin network
// wrappers below it are integration-tested live (see the offboarding plan run).
import type { TenantSettings } from "@/lib/types/tenant-settings";
import { deleteAssistant, TEMPLATE_VAPI_ASSISTANT_ID } from "@/lib/onboarding/vapi";

// --- Pure selection helpers ----------------------------------------------------
//
// (The n8n workflow teardown — listN8nWorkflows / n8nWorkflowIdsToRemove /
// activate/deactivate/deleteN8nWorkflow — was removed when n8n was shut down. The
// bot-engine Worker is dynamic: a tenant has no per-tenant workflows to delete.
// The only "engine" teardown left is removing the tenant from the KV sandbox
// routing list, handled in delete-tenant.ts via sandbox-registry.ts.)

export type VoiceProvider = "vapi" | "retell" | "none";
export interface VoiceTeardownPlan {
  provider: VoiceProvider;
  vapiAssistantId?: string;
  retellAgentId?: string;
  retellLlmId?: string;
  retellKbId?: string;
}

/** Detect which voice provider a tenant uses and what to delete.
 *
 * SAFETY: never plan to delete the shared GOLDEN TEMPLATE assistant. PICNIC (the
 * legacy template tenant) carries the template's own id in settings.vapi —
 * deleting it on teardown would wipe the assistant every new tenant is cloned
 * from. If a tenant's vapi.assistantId IS the template, treat its Vapi side as
 * "nothing to delete" (fall through to Retell / none). A real clone always has
 * its own unique id, so this only ever spares the template. */
export function voiceTeardownPlan(settings: TenantSettings | null | undefined): VoiceTeardownPlan {
  const s = (settings || {}) as any;
  if (s.vapi?.assistantId && s.vapi.assistantId !== TEMPLATE_VAPI_ASSISTANT_ID) {
    return { provider: "vapi", vapiAssistantId: s.vapi.assistantId };
  }
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
 * users that belong to another tenant. Everyone else who belongs ONLY to this
 * tenant — synthetic QR-staff (@baliflow.local) and real single-tenant staff
 * alike — is deleted, so their email is freed for re-registration after the
 * service is cancelled. (The `ban` bucket is retained for back-compat but is no
 * longer populated.) */
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
    plan.delete.push(m.user_id);
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
