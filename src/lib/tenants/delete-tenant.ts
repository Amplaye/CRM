import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantStatus } from "./status";
import { buildTenantExport, uploadTenantExport } from "./export-tenant";
import {
  n8nWorkflowIdsToRemove,
  voiceTeardownPlan,
  classifyStaffForTeardown,
  botSessionPhonesToClean,
  listN8nWorkflows,
  activateN8nWorkflow,
  deactivateN8nWorkflow,
  deleteN8nWorkflow,
  deleteVapiAssistant,
  deleteRetellVoice,
  type StaffMember,
} from "./teardown";

/** Recoverable window before automatic permanent deletion. */
export const GRACE_PERIOD_DAYS = 90;

export function computePurgeAfter(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + GRACE_PERIOD_DAYS);
  return d;
}

/**
 * Archive a tenant: hide it + stop its traffic, reversibly, for the grace
 * period. Flips status→archived, records archived_at/purge_after + prev_status,
 * and DEACTIVATES (not deletes) its n8n workflows. n8n being unreachable does
 * not block the DB archive.
 */
export async function archiveTenant(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { exportPath?: string } = {}
): Promise<{ purge_after: string }> {
  const { data: tenant, error } = await supabase
    .from("tenants").select("id, name, status, settings").eq("id", tenantId).single();
  if (error || !tenant) throw new Error(`archive: tenant ${tenantId} not found`);
  if (tenant.status === "archived") throw new Error("already archived");

  const now = new Date();
  const purgeAfter = computePurgeAfter(now);
  const settings = { ...((tenant.settings as any) || {}) };
  settings.archive = {
    ...(settings.archive || {}),
    prev_status: tenant.status as TenantStatus,
    ...(opts.exportPath ? { export_path: opts.exportPath } : {}),
  };

  const stored = (settings.n8n?.workflow_ids as string[]) || [];
  try {
    const all = await listN8nWorkflows();
    for (const id of n8nWorkflowIdsToRemove(all, tenant.name, stored)) {
      await deactivateN8nWorkflow(id).catch(() => {});
    }
  } catch { /* n8n unreachable: archive in DB anyway */ }

  const { error: upErr } = await supabase.from("tenants").update({
    status: "archived",
    archived_at: now.toISOString(),
    purge_after: purgeAfter.toISOString(),
    settings,
  }).eq("id", tenantId);
  if (upErr) throw new Error(`archive update: ${upErr.message}`);
  return { purge_after: purgeAfter.toISOString() };
}

/** Restore an archived tenant to its previous status and reactivate its n8n
 * workflows. */
export async function restoreTenant(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ status: TenantStatus }> {
  const { data: tenant, error } = await supabase
    .from("tenants").select("id, name, status, settings").eq("id", tenantId).single();
  if (error || !tenant) throw new Error(`restore: tenant ${tenantId} not found`);
  if (tenant.status !== "archived") throw new Error("not archived");

  const settings = { ...((tenant.settings as any) || {}) };
  const prev = (settings.archive?.prev_status as TenantStatus) || "active";
  delete settings.archive;

  const stored = (settings.n8n?.workflow_ids as string[]) || [];
  try {
    const all = await listN8nWorkflows();
    for (const id of n8nWorkflowIdsToRemove(all, tenant.name, stored)) {
      await activateN8nWorkflow(id).catch(() => {});
    }
  } catch { /* n8n unreachable */ }

  const { error: upErr } = await supabase.from("tenants").update({
    status: prev, archived_at: null, purge_after: null, settings,
  }).eq("id", tenantId);
  if (upErr) throw new Error(`restore update: ${upErr.message}`);
  return { status: prev };
}

/** Network/side-effecting deps, injectable so the orchestrator is unit-testable. */
export interface PurgeDeps {
  buildExport: typeof buildTenantExport;
  uploadExport: typeof uploadTenantExport;
  listWorkflows: typeof listN8nWorkflows;
  deleteWorkflow: typeof deleteN8nWorkflow;
  deleteVapi: (assistantId: string) => Promise<void>;
  deleteRetell: typeof deleteRetellVoice;
}
const realDeps: PurgeDeps = {
  buildExport: buildTenantExport,
  uploadExport: uploadTenantExport,
  listWorkflows: listN8nWorkflows,
  deleteWorkflow: deleteN8nWorkflow,
  deleteVapi: deleteVapiAssistant,
  deleteRetell: deleteRetellVoice,
};

export interface PurgeResult {
  tenantName: string;
  exportPath: string | null;
  workflowsDeleted: number;
  voiceProvider: string;
  staffDeleted: number;
  staffBanned: number;
  staffSkipped: number;
}

async function resolveStaffPlan(supabase: SupabaseClient, tenantId: string, userIds: string[]) {
  const staff: StaffMember[] = [];
  for (const uid of userIds) {
    const [{ data: prof }, otherRes, authRes] = await Promise.all([
      supabase.from("users").select("global_role").eq("id", uid).maybeSingle(),
      supabase.from("tenant_members").select("id", { count: "exact", head: true }).eq("user_id", uid).neq("tenant_id", tenantId),
      supabase.auth.admin.getUserById(uid),
    ]);
    staff.push({
      user_id: uid,
      email: (authRes as any)?.data?.user?.email || "",
      global_role: (prof as any)?.global_role || null,
      otherTenantCount: (otherRes as any)?.count || 0,
    });
  }
  return classifyStaffForTeardown(staff);
}

/**
 * Permanently purge a tenant. Order matters: back up → collect guest phones →
 * external teardown (n8n, voice) → staff login teardown (captured before the
 * cascade) → manual orphan cleanup → DELETE the tenant row (cascades 15 tables).
 * The durable "purged" audit record is the CALLER's job (system_logs, tenant_id
 * null) because any audit_events row for this tenant cascades away with it.
 */
export async function purgeTenant(
  supabase: SupabaseClient,
  tenantId: string,
  deps: PurgeDeps = realDeps
): Promise<PurgeResult> {
  const { data: tenant, error } = await supabase
    .from("tenants").select("id, name, status, settings").eq("id", tenantId).single();
  if (error || !tenant) throw new Error(`purge: tenant ${tenantId} not found`);
  const name = tenant.name as string;
  const settings = (tenant.settings as any) || {};

  // 1) Backup (idempotent — re-export now so an immediate "delete now" is covered too).
  let exportPath: string | null = (settings.archive?.export_path as string) || null;
  try {
    const data = await deps.buildExport(supabase, tenantId);
    exportPath = (await deps.uploadExport(supabase, tenantId, data)).path;
  } catch { /* never block teardown on backup failure; caller logs */ }

  // 2) Guest phones (needed for bot_sessions BEFORE the cascade removes guests).
  const { data: myGuests } = await supabase.from("guests").select("phone").eq("tenant_id", tenantId);
  const myPhones = ((myGuests as any[]) || []).map((g) => g.phone).filter(Boolean);

  // 3) n8n teardown.
  const stored = (settings.n8n?.workflow_ids as string[]) || [];
  let workflowsDeleted = 0;
  try {
    const all = await deps.listWorkflows();
    for (const id of n8nWorkflowIdsToRemove(all, name, stored)) {
      try { await deps.deleteWorkflow(id); workflowsDeleted++; } catch { /* tolerate */ }
    }
  } catch { /* n8n unreachable: surfaced via workflowsDeleted=0 */ }

  // 4) Voice teardown (vapi xor retell).
  const vp = voiceTeardownPlan(settings);
  try {
    if (vp.provider === "vapi" && vp.vapiAssistantId) await deps.deleteVapi(vp.vapiAssistantId);
    else if (vp.provider === "retell") await deps.deleteRetell(vp);
  } catch { /* tolerate */ }

  // 5) Staff logins (capture members BEFORE cascade; never touch admins/multi-tenant).
  const { data: members } = await supabase.from("tenant_members").select("user_id").eq("tenant_id", tenantId);
  const userIds = Array.from(new Set(((members as any[]) || []).map((m) => m.user_id)));
  const staffPlan = await resolveStaffPlan(supabase, tenantId, userIds);
  let staffDeleted = 0, staffBanned = 0;
  for (const uid of staffPlan.delete) {
    try { await supabase.auth.admin.deleteUser(uid); staffDeleted++; } catch { /* tolerate */ }
  }
  for (const uid of staffPlan.ban) {
    try { await supabase.auth.admin.updateUserById(uid, { ban_duration: "876000h" }); staffBanned++; } catch { /* tolerate */ }
  }

  // 6) Manual orphan cleanup (tenant_id, no FK) + bot_sessions by phone.
  await supabase.from("bot_fixes").delete().eq("tenant_id", tenantId);
  await supabase.from("trello_synced_audits").delete().eq("tenant_id", tenantId);
  await supabase.from("webhook_events").delete().eq("tenant_id", tenantId); // tenant_id is text
  if (myPhones.length) {
    const { data: otherGuests } = await supabase
      .from("guests").select("phone").neq("tenant_id", tenantId).in("phone", myPhones);
    const otherPhones = ((otherGuests as any[]) || []).map((g) => g.phone).filter(Boolean);
    const toClean = botSessionPhonesToClean(myPhones, otherPhones);
    if (toClean.length) await supabase.from("bot_sessions").delete().in("phone", toClean);
  }

  // 7) DELETE the tenant → cascades the 15 FK tables.
  const { error: delErr } = await supabase.from("tenants").delete().eq("id", tenantId);
  if (delErr) throw new Error(`purge delete tenant: ${delErr.message}`);

  return {
    tenantName: name,
    exportPath,
    workflowsDeleted,
    voiceProvider: vp.provider,
    staffDeleted,
    staffBanned,
    staffSkipped: staffPlan.skip.length,
  };
}
