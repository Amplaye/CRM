# Tenant Offboarding (Archive → Purge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give platform_admins an "archive-then-purge" tenant removal flow in the BaliFlow CRM admin: a tenant disappears from the CRM immediately (archived, no traffic, recoverable ~30 days), is auto-deleted after the grace period, with manual "delete now" and "restore" options. Deletion exports the data first and tears down the tenant's external services (n8n workflows, Vapi/Retell voice, staff logins).

**Architecture:** `status.ts` stays the single source of truth — add an `"archived"` status (NOT traffic-allowed, NOT admin-dropdown-settable) plus `archived_at`/`purge_after` columns. A new `delete-tenant.ts` (mirrors `create-tenant.ts`) holds three orchestrators — `archiveTenant`, `restoreTenant`, `purgeTenant` — built on small **pure** selection helpers in `teardown.ts` (which workflows to kill, which voice provider, which staff, which bot_sessions) plus thin network wrappers. Protected POST endpoints under `/api/admin/tenant/{archive,restore,purge}` (typed-name confirmation, platform_admin gate) drive it; a daily **Vercel Cron** hits `/api/cron/purge-tenants` (CRON_SECRET) to purge tenants whose grace period expired. Export = JSON in a private Supabase Storage bucket `tenant-exports` + a signed download link.

**Tech Stack:** Next.js 16 (App Router, route handlers — mirror existing `src/app/api/admin/tenant/route.ts`), Supabase (service-role client, Postgres FK cascade, Storage), Vitest (`vitest run`), Vercel Cron. External APIs: n8n (`/api/v1`, `X-N8N-API-KEY`), Vapi (`api.vapi.ai`, `VAPI_PRIVATE_KEY`), Retell (`api.retellai.com`, `RETELL_API_KEY`).

---

## Verified facts (2026-05-22, live)

- **Cascade**: `DELETE FROM tenants WHERE id=…` cascades exactly **15** tables: `audit_events, client_notes, conversation_audits, conversations, guests, incidents, knowledge_articles, qr_login_tokens, reservation_events, reservations, restaurant_tables, system_logs, tenant_api_keys, tenant_members, waitlist_entries`.
- **Orphans (tenant_id col, NO FK → delete by hand)**: `bot_fixes` (tenant_id uuid), `trello_synced_audits` (tenant_id uuid), `webhook_events` (**tenant_id text**).
- **`bot_sessions`**: keyed by `phone` (text) — no tenant_id. Clean by the tenant's guest phones (`guests.phone` is text), minus phones shared with other tenants.
- **status check constraint** currently: `('pending','trial','active','suspended')` — must add `'archived'`.
- **`audit_events.tenant_id` is NOT NULL + ON DELETE CASCADE** → an audit row for a tenant is destroyed when the tenant is. `system_logs.tenant_id` is **nullable** + ON DELETE CASCADE → a row with `tenant_id = NULL` survives the cascade. **The durable "purged" record MUST be a `system_logs` insert with `tenant_id: null`** (tenant id/name go in metadata).
- **Settings paths**: voice = `settings.vapi.assistantId` (new tenants) **or** `settings.retell.{agentId,llmId}` + `settings.retell_kb.id` (legacy); n8n = `settings.n8n.workflow_ids[]` (may be absent on legacy tenants); WhatsApp sender = `settings.whatsapp.from` (string only — no per-tenant Twilio resource to release; sandbox tenants have nothing).
- **Auth gate**: `assertPlatformAdmin()` in `src/lib/admin-auth.ts` (checks `users.global_role === 'platform_admin'`).
- **Audit helpers**: `logAuditEvent(...)` (`src/lib/audit.ts`, needs `tenant_id`), `logSystemEvent({ tenant_id?, category, severity, title, ... })` (`src/lib/system-log.ts`, accepts null tenant_id).
- **Staff removal precedent**: `src/app/api/team/remove-member/route.ts` — QR-staff have synthetic `@baliflow.local` emails and get `auth.admin.deleteUser`; real staff are left to the realtime guard / cascade.
- **Live test tenant — Fuoricittà** `846033e1-b32a-4ac9-b8c3-43bc18963596` (status active): legacy **Retell** voice (`agent_3418785ab580876fe03e59b41e`, `llm_d31b881f3f946d998e704f211906`, kb `knowledge_base_48d01ea799638f15` — all reachable, HTTP 200), **no** `settings.n8n.workflow_ids` but **13 live workflows** named `[Fuoricittà] …`, no `settings.whatsapp.from`, 0 reservations/guests/conversations/members, **4 knowledge_articles**.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/tenants/status.ts` (modify) | Add `"archived"` to the union/guards; keep it out of traffic + admin dropdown. |
| `src/lib/types/tenant-settings.ts` (modify) | Type the `archive`, `vapi`, `retell`, `retell_kb`, `n8n` keys. |
| `src/lib/tenants/teardown.ts` (create) | Pure selection helpers + thin n8n/Vapi/Retell network wrappers. |
| `src/lib/tenants/export-tenant.ts` (create) | Build the JSON export; upload to Storage; signed URL. |
| `src/lib/tenants/delete-tenant.ts` (create) | `archiveTenant` / `restoreTenant` / `purgeTenant` orchestrators (injectable deps). |
| `src/app/api/admin/tenant/archive/route.ts` (create) | POST: export → archive, returns download link + purge_after. |
| `src/app/api/admin/tenant/restore/route.ts` (create) | POST: restore an archived tenant. |
| `src/app/api/admin/tenant/purge/route.ts` (create) | POST: immediate manual purge (typed-name). |
| `src/app/api/admin/archived-tenants/route.ts` (create) | GET: list archived tenants for the admin UI. |
| `src/app/api/cron/purge-tenants/route.ts` (create) | GET (CRON_SECRET): purge tenants past `purge_after`. |
| `src/app/api/admin/tenant/route.ts` (modify) | Reject setting `status='archived'` via the dropdown. |
| `src/app/api/admin/overview/route.ts` (modify) | Exclude archived tenants from the main list. |
| `src/app/(dashboard)/admin/tenant/[id]/page.tsx` (modify) | "Danger Zone": archive / delete-now / (when archived) restore + purge, with typed-name modal. |
| `src/app/(dashboard)/admin/page.tsx` (modify) | "Archiviati" section (restore / delete-now). |
| `vercel.json` (create) | Daily cron → `/api/cron/purge-tenants`. |
| `supabase-schema.sql` (modify) | Reflect the new constraint + columns (docs parity). |
| `*.test.ts` (create/modify) | Unit tests for status + pure helpers + export builder + purge orchestration. |

**Invariant guard (do not violate `src/lib/saas-invariants.test.ts`):** never hardcode the template owner phone `34641790137`, the sandbox sender `14155238886`, or the banned constants (`TENANT_CONFIG_FALLBACK`, `TENANT_VAPI_FALLBACK`, `PICNIC_WEBHOOK`). New code reads everything from `settings`/env.

---

## Task 1: DB migration — `archived` status + columns

**Files:**
- Modify (live DDL via Supabase Management API): project `azhlnybiqlkbhbboyvud`
- Modify: `supabase-schema.sql` (docs parity only)

- [ ] **Step 1: Apply the migration live (Management API)**

Run (token from memory `credentials.md`, "BaliFlow CRM" Management token):

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query" \
  -H "Authorization: Bearer <SUPABASE_MGMT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query":"alter table public.tenants drop constraint if exists tenants_status_check; alter table public.tenants add constraint tenants_status_check check (status in ('"'"'pending'"'"','"'"'trial'"'"','"'"'active'"'"','"'"'suspended'"'"','"'"'archived'"'"')); alter table public.tenants add column if not exists archived_at timestamptz; alter table public.tenants add column if not exists purge_after timestamptz;"}'
```

Expected: `[]` (no error).

- [ ] **Step 2: Verify live**

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query" \
  -H "Authorization: Bearer <SUPABASE_MGMT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"query":"select pg_get_constraintdef(oid) from pg_constraint where conname='"'"'tenants_status_check'"'"'; select column_name from information_schema.columns where table_name='"'"'tenants'"'"' and column_name in ('"'"'archived_at'"'"','"'"'purge_after'"'"');"}'
```

Expected: the check def includes `'archived'`; both columns listed.

- [ ] **Step 3: Reflect in `supabase-schema.sql`** (find the `tenants` table definition; update the status check to include `'archived'` and add the two columns next to `status`). Documentation parity — no behavior change.

- [ ] **Step 4: Commit**

```bash
git add supabase-schema.sql && git commit -m "feat(tenants): add 'archived' status + archived_at/purge_after columns"
```

---

## Task 2: `status.ts` — add `archived` (single source of truth)

**Files:**
- Modify: `src/lib/tenants/status.ts`
- Test: `src/lib/tenants/status.test.ts`

- [ ] **Step 1: Write failing tests** — append to `status.test.ts`:

```ts
import { isAdminSettableStatus } from "./status";

describe("archived status", () => {
  it("archived is a valid TenantStatus", () => {
    expect(isTenantStatus("archived")).toBe(true);
  });
  it("archived does NOT receive traffic", () => {
    expect(tenantReceivesTraffic("archived")).toBe(false);
  });
  it("archived is not offered in the admin status dropdown", () => {
    expect(TENANT_STATUSES.map((s) => s.value)).not.toContain("archived");
  });
  it("admin cannot set archived via the dropdown guard", () => {
    expect(isAdminSettableStatus("active")).toBe(true);
    expect(isAdminSettableStatus("archived")).toBe(false);
  });
});
```

(Ensure `isTenantStatus`, `tenantReceivesTraffic`, `TENANT_STATUSES` are imported at the top of the file — they already are in the existing suite.)

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run src/lib/tenants/status.test.ts`
Expected: FAIL (`isAdminSettableStatus` not exported; `isTenantStatus("archived")` false).

- [ ] **Step 3: Implement** — edit `src/lib/tenants/status.ts`:

Change the type:
```ts
export type TenantStatus = "pending" | "trial" | "active" | "suspended" | "archived";
```
Update the doc comment block to add a line:
```
 *   archived  — soft-removed via offboarding; hidden, no traffic, purged after a grace period.
```
`TRAFFIC_ALLOWED_STATUSES` stays `["trial", "active"]` (archived must NOT be added).
`TENANT_STATUSES` stays the existing four (do NOT add archived — it is set only by the offboarding flow). Add a trailing comment:
```ts
  // 'archived' is intentionally absent — set only via the tenant offboarding flow.
```
Replace `isTenantStatus`:
```ts
export function isTenantStatus(v: unknown): v is TenantStatus {
  return v === "pending" || v === "trial" || v === "active" || v === "suspended" || v === "archived";
}

/** Statuses an admin may set via the status dropdown — excludes 'archived',
 * which is reachable only through the protected archive/restore flow. */
export function isAdminSettableStatus(v: unknown): v is TenantStatus {
  return isTenantStatus(v) && v !== "archived";
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run src/lib/tenants/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenants/status.ts src/lib/tenants/status.test.ts
git commit -m "feat(tenants): add archived status + isAdminSettableStatus guard"
```

---

## Task 3: Type the offboarding-relevant `settings` keys

**Files:**
- Modify: `src/lib/types/tenant-settings.ts`

- [ ] **Step 1: Implement** — in `src/lib/types/tenant-settings.ts`, add an import at the top:

```ts
import type { TenantStatus } from "@/lib/tenants/status";
```

Then inside `interface TenantSettings`, above the `[key: string]: any;` line, add:

```ts
  /** Offboarding bookkeeping, written by the archive flow (src/lib/tenants/delete-tenant.ts). */
  archive?: { prev_status: TenantStatus; export_path?: string };
  /** Voice provider config — exactly one is present per tenant. */
  vapi?: { assistantId?: string };
  retell?: { agentId?: string; llmId?: string };
  retell_kb?: { id?: string };
  /** Cloned n8n workflow ids (present for tenants provisioned via the orchestrator). */
  n8n?: { workflow_ids?: string[] };
```

- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit` (expect no new errors from this file). If the project has no `tsc` script, rely on `npm run build` later (Task 12).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/tenant-settings.ts
git commit -m "feat(tenants): type archive/vapi/retell/n8n keys in TenantSettings"
```

---

## Task 4: `teardown.ts` — pure selection helpers (the safety-critical logic)

**Files:**
- Create: `src/lib/tenants/teardown.ts`
- Test: `src/lib/tenants/teardown.test.ts`

- [ ] **Step 1: Write failing tests** — `src/lib/tenants/teardown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  n8nWorkflowIdsToRemove,
  voiceTeardownPlan,
  classifyStaffForTeardown,
  botSessionPhonesToClean,
} from "./teardown";

describe("n8nWorkflowIdsToRemove", () => {
  const all = [
    { id: "a", name: "[Fuoricittà] Reminders" },
    { id: "b", name: "[Fuoricittà] Chatbot WhatsApp" },
    { id: "c", name: "[Picnic] Reminders" },
    { id: "d", name: "Some other flow" },
  ];
  it("matches by name prefix", () => {
    expect(n8nWorkflowIdsToRemove(all, "Fuoricittà").sort()).toEqual(["a", "b"]);
  });
  it("never matches another tenant or unrelated flows", () => {
    const got = n8nWorkflowIdsToRemove(all, "Fuoricittà");
    expect(got).not.toContain("c");
    expect(got).not.toContain("d");
  });
  it("unions stored ids with name matches, de-duped", () => {
    expect(n8nWorkflowIdsToRemove(all, "Fuoricittà", ["a", "z"]).sort()).toEqual(["a", "b", "z"]);
  });
});

describe("voiceTeardownPlan", () => {
  it("prefers vapi when assistantId present", () => {
    expect(voiceTeardownPlan({ vapi: { assistantId: "v1" } })).toEqual({ provider: "vapi", vapiAssistantId: "v1" });
  });
  it("falls back to retell agent + llm + kb", () => {
    expect(
      voiceTeardownPlan({ retell: { agentId: "ag", llmId: "ll" }, retell_kb: { id: "kb" } })
    ).toEqual({ provider: "retell", retellAgentId: "ag", retellLlmId: "ll", retellKbId: "kb" });
  });
  it("returns none when no voice config", () => {
    expect(voiceTeardownPlan({}).provider).toBe("none");
    expect(voiceTeardownPlan(null).provider).toBe("none");
  });
});

describe("classifyStaffForTeardown", () => {
  it("never touches platform_admins or multi-tenant users", () => {
    const plan = classifyStaffForTeardown([
      { user_id: "admin", email: "a@x.com", global_role: "platform_admin", otherTenantCount: 0 },
      { user_id: "multi", email: "m@x.com", global_role: "user", otherTenantCount: 2 },
    ]);
    expect(plan.skip.sort()).toEqual(["admin", "multi"]);
    expect(plan.delete).toEqual([]);
    expect(plan.ban).toEqual([]);
  });
  it("deletes QR-staff, bans real single-tenant staff", () => {
    const plan = classifyStaffForTeardown([
      { user_id: "qr", email: "x@baliflow.local", global_role: "user", otherTenantCount: 0 },
      { user_id: "real", email: "joe@gmail.com", global_role: "user", otherTenantCount: 0 },
    ]);
    expect(plan.delete).toEqual(["qr"]);
    expect(plan.ban).toEqual(["real"]);
  });
  it("de-dupes repeated user_ids", () => {
    const plan = classifyStaffForTeardown([
      { user_id: "qr", email: "x@baliflow.local", global_role: "user", otherTenantCount: 0 },
      { user_id: "qr", email: "x@baliflow.local", global_role: "user", otherTenantCount: 0 },
    ]);
    expect(plan.delete).toEqual(["qr"]);
  });
});

describe("botSessionPhonesToClean", () => {
  it("keeps only phones not used by other tenants", () => {
    expect(botSessionPhonesToClean(["+1", "+2", "+3"], ["+2"]).sort()).toEqual(["+1", "+3"]);
  });
  it("de-dupes and drops empties", () => {
    expect(botSessionPhonesToClean(["+1", "+1", ""], []).sort()).toEqual(["+1"]);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run src/lib/tenants/teardown.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure helpers** — create `src/lib/tenants/teardown.ts` with this top section (network wrappers added in Task 5):

```ts
// Tenant teardown helpers.
//
// The selection logic (which workflows to kill, which voice provider, which
// staff, which bot_sessions) is PURE and unit-tested here — it is the part that,
// if wrong, would touch the wrong tenant. The thin network wrappers below it are
// integration-tested live (see the offboarding plan's live run).
import type { TenantSettings } from "@/lib/types/tenant-settings";

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
export interface StaffPlan { delete: string[]; ban: string[]; skip: string[]; }

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
    if (m.global_role === "platform_admin" || m.otherTenantCount > 0) { plan.skip.push(m.user_id); continue; }
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
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run src/lib/tenants/teardown.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenants/teardown.ts src/lib/tenants/teardown.test.ts
git commit -m "feat(tenants): pure teardown selection helpers (n8n/voice/staff/bot_sessions)"
```

---

## Task 5: `teardown.ts` — network wrappers (n8n / Vapi / Retell)

**Files:**
- Modify: `src/lib/tenants/teardown.ts` (append)

- [ ] **Step 1: Append the wrappers** to `src/lib/tenants/teardown.ts`:

```ts
import { deleteAssistant } from "@/lib/onboarding/vapi";

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
  if (!res.ok && res.status !== 404) throw new Error(`retell ${label} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
```

- [ ] **Step 2: Verify the pure tests still pass** (no behavioral change to the pure section):

Run: `npx vitest run src/lib/tenants/teardown.test.ts`
Expected: PASS.

- [ ] **Step 3: Verify Retell delete-endpoint shapes live (read-only probe — do NOT delete yet)** — confirm the agent GET works with the key so the DELETE paths are valid (Retell uses the same `/{resource}/{id}` shape for GET/DELETE):

```bash
curl -s -o /dev/null -w "agent GET=%{http_code}\n" \
  "https://api.retellai.com/get-agent/agent_3418785ab580876fe03e59b41e" \
  -H "Authorization: Bearer <RETELL_API_KEY>"
```
Expected: `agent GET=200` (confirms key + agent id; DELETE will be exercised in the live run, Task 13).

- [ ] **Step 4: Commit**

```bash
git add src/lib/tenants/teardown.ts
git commit -m "feat(tenants): n8n/Vapi/Retell teardown network wrappers"
```

---

## Task 6: `export-tenant.ts` — backup builder + Storage upload

**Files:**
- Create: `src/lib/tenants/export-tenant.ts`
- Test: `src/lib/tenants/export-tenant.test.ts`

- [ ] **Step 1: Write failing test** — `src/lib/tenants/export-tenant.test.ts` (unit-tests the builder with a hand-rolled fake supabase; upload is exercised live in Task 13):

```ts
import { describe, it, expect } from "vitest";
import { buildTenantExport } from "./export-tenant";

/** Minimal fake: .from(table).select(...).eq(...) resolves canned rows;
 * the tenants table resolves .single(). */
function fakeSupabase(data: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = data[table] || [];
      const builder: any = {
        select() { return builder; },
        eq() { return builder; },
        single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: "no row" } }),
        then(resolve: any) { resolve({ data: rows, error: null }); }, // awaitable for list queries
      };
      return builder;
    },
  };
}

describe("buildTenantExport", () => {
  it("collects the four data tables + tenant under one object", async () => {
    const supabase = fakeSupabase({
      tenants: [{ id: "t1", name: "Foo", status: "active", settings: {}, created_at: "2026-01-01" }],
      reservations: [{ id: "r1" }],
      guests: [{ id: "g1" }],
      conversations: [{ id: "c1" }],
      knowledge_articles: [{ id: "k1" }, { id: "k2" }],
    });
    const out = await buildTenantExport(supabase as any, "t1");
    expect(out.tenant.name).toBe("Foo");
    expect(out.reservations).toHaveLength(1);
    expect(out.guests).toHaveLength(1);
    expect(out.conversations).toHaveLength(1);
    expect(out.knowledge_articles).toHaveLength(2);
    expect(typeof out.exported_at).toBe("string");
  });

  it("throws when the tenant does not exist", async () => {
    const supabase = fakeSupabase({ tenants: [] });
    await expect(buildTenantExport(supabase as any, "missing")).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run src/lib/tenants/export-tenant.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/lib/tenants/export-tenant.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** Private bucket holding pre-deletion backups (one JSON per archive event). */
export const EXPORT_BUCKET = "tenant-exports";

export interface TenantExport {
  exported_at: string;
  tenant: { id: string; name: string; status: string; settings: any; created_at: string };
  reservations: any[];
  guests: any[];
  conversations: any[];
  knowledge_articles: any[];
}

/** Build the downloadable backup: the tenant row + its reservations, guests,
 * conversations and knowledge_articles. */
export async function buildTenantExport(supabase: SupabaseClient, tenantId: string): Promise<TenantExport> {
  const [tenantRes, reservations, guests, conversations, kb] = await Promise.all([
    supabase.from("tenants").select("id, name, status, settings, created_at").eq("id", tenantId).single(),
    supabase.from("reservations").select("*").eq("tenant_id", tenantId),
    supabase.from("guests").select("*").eq("tenant_id", tenantId),
    supabase.from("conversations").select("*").eq("tenant_id", tenantId),
    supabase.from("knowledge_articles").select("*").eq("tenant_id", tenantId),
  ]);
  if (tenantRes.error || !tenantRes.data) throw new Error(`export: tenant ${tenantId} not found`);
  return {
    exported_at: new Date().toISOString(),
    tenant: tenantRes.data as any,
    reservations: (reservations as any).data || [],
    guests: (guests as any).data || [],
    conversations: (conversations as any).data || [],
    knowledge_articles: (kb as any).data || [],
  };
}

/** Upload the export JSON to the private bucket; return its path + a 7-day
 * signed download URL. Creating the bucket is idempotent (ignore "exists"). */
export async function uploadTenantExport(
  supabase: SupabaseClient,
  tenantId: string,
  data: TenantExport
): Promise<{ path: string; signedUrl: string | null }> {
  await supabase.storage.createBucket(EXPORT_BUCKET, { public: false }).catch(() => {});
  const path = `${tenantId}/${data.exported_at.replace(/[:.]/g, "-")}.json`;
  const { error } = await supabase.storage
    .from(EXPORT_BUCKET)
    .upload(path, JSON.stringify(data, null, 2), { contentType: "application/json", upsert: true });
  if (error) throw new Error(`export upload: ${error.message}`);
  const { data: signed } = await supabase.storage.from(EXPORT_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  return { path, signedUrl: signed?.signedUrl || null };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run src/lib/tenants/export-tenant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenants/export-tenant.ts src/lib/tenants/export-tenant.test.ts
git commit -m "feat(tenants): tenant data export builder + Storage upload"
```

---

## Task 7: `delete-tenant.ts` — archive / restore / purge orchestrators

**Files:**
- Create: `src/lib/tenants/delete-tenant.ts`
- Test: `src/lib/tenants/delete-tenant.test.ts`

- [ ] **Step 1: Implement** — create `src/lib/tenants/delete-tenant.ts`:

```ts
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
export const GRACE_PERIOD_DAYS = 30;

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
```

- [ ] **Step 2: Write the orchestration test** — `src/lib/tenants/delete-tenant.test.ts`. Uses a minimal in-memory fake supabase to lock the critical invariants (deletes tenant LAST, cleans the 3 orphan tables, calls the right voice path, deletes each n8n id):

```ts
import { describe, it, expect, vi } from "vitest";
import { computePurgeAfter, GRACE_PERIOD_DAYS, purgeTenant, type PurgeDeps } from "./delete-tenant";

describe("computePurgeAfter", () => {
  it("adds the grace period", () => {
    const from = new Date("2026-05-22T00:00:00Z");
    const got = computePurgeAfter(from);
    const expected = new Date(from); expected.setDate(expected.getDate() + GRACE_PERIOD_DAYS);
    expect(got.toISOString()).toBe(expected.toISOString());
  });
});

/** Fake supabase that records the order of table mutations. */
function fakeSupabase(opts: { settings?: any; guests?: any[] }) {
  const calls: string[] = [];
  const tenantRow = { id: "t1", name: "Fuoricittà", status: "archived", settings: opts.settings || {} };
  const builder = (table: string) => {
    const b: any = {
      _filters: {} as any,
      select() { return b; },
      eq(_c: string, _v: any) { return b; },
      neq() { return b; },
      in() { return b; },
      maybeSingle: async () => ({ data: null }),
      single: async () => (table === "tenants" ? { data: tenantRow, error: null } : { data: null, error: null }),
      delete() { calls.push(`delete:${table}`); return b; },
      then(resolve: any) {
        if (table === "guests") return resolve({ data: opts.guests || [], error: null });
        return resolve({ data: [], error: null, count: 0 });
      },
    };
    return b;
  };
  return {
    calls,
    from: (t: string) => builder(t),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "" } } }), deleteUser: async () => {}, updateUserById: async () => {} } },
  } as any;
}

function stubDeps(over: Partial<PurgeDeps> = {}): PurgeDeps {
  return {
    buildExport: vi.fn(async () => ({ exported_at: "x", tenant: {} as any, reservations: [], guests: [], conversations: [], knowledge_articles: [] })),
    uploadExport: vi.fn(async () => ({ path: "t1/x.json", signedUrl: null })),
    listWorkflows: vi.fn(async () => [{ id: "a", name: "[Fuoricittà] Reminders", active: true }, { id: "b", name: "[Fuoricittà] Chatbot WhatsApp", active: true }]),
    deleteWorkflow: vi.fn(async () => {}),
    deleteVapi: vi.fn(async () => {}),
    deleteRetell: vi.fn(async () => {}),
    ...over,
  };
}

describe("purgeTenant", () => {
  it("retells legacy tenants and deletes the tenant row LAST", async () => {
    const supabase = fakeSupabase({ settings: { retell: { agentId: "ag", llmId: "ll" }, retell_kb: { id: "kb" } } });
    const deps = stubDeps();
    const res = await purgeTenant(supabase, "t1", deps);

    expect(deps.deleteRetell).toHaveBeenCalledWith({ provider: "retell", retellAgentId: "ag", retellLlmId: "ll", retellKbId: "kb" });
    expect(deps.deleteVapi).not.toHaveBeenCalled();
    expect((deps.deleteWorkflow as any).mock.calls.map((c: any[]) => c[0]).sort()).toEqual(["a", "b"]);
    expect(res.voiceProvider).toBe("retell");
    expect(res.workflowsDeleted).toBe(2);

    // orphan tables cleaned, and the tenant delete is the LAST delete recorded
    expect(supabase.calls).toEqual(
      expect.arrayContaining(["delete:bot_fixes", "delete:trello_synced_audits", "delete:webhook_events"])
    );
    expect(supabase.calls[supabase.calls.length - 1]).toBe("delete:tenants");
  });

  it("uses Vapi when assistantId is present", async () => {
    const supabase = fakeSupabase({ settings: { vapi: { assistantId: "v1" } } });
    const deps = stubDeps();
    await purgeTenant(supabase, "t1", deps);
    expect(deps.deleteVapi).toHaveBeenCalledWith("v1");
    expect(deps.deleteRetell).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — verify pass**

Run: `npx vitest run src/lib/tenants/delete-tenant.test.ts`
Expected: PASS (3 tests).
> If the fake's `then`/awaitable shape needs tweaking for your supabase-js typings, adjust the fake only — do not change `delete-tenant.ts` to satisfy the test.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tenants/delete-tenant.ts src/lib/tenants/delete-tenant.test.ts
git commit -m "feat(tenants): archive/restore/purge orchestrators (delete-tenant.ts)"
```

---

## Task 8: Admin API — archive / restore / purge / archived-list

**Files:**
- Create: `src/app/api/admin/tenant/archive/route.ts`
- Create: `src/app/api/admin/tenant/restore/route.ts`
- Create: `src/app/api/admin/tenant/purge/route.ts`
- Create: `src/app/api/admin/archived-tenants/route.ts`

- [ ] **Step 1: Archive route** — `src/app/api/admin/tenant/archive/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { archiveTenant } from "@/lib/tenants/delete-tenant";
import { buildTenantExport, uploadTenantExport } from "@/lib/tenants/export-tenant";
import { logAuditEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const { tenant_id, confirm_name } = await req.json();
    if (!tenant_id || !confirm_name) {
      return NextResponse.json({ error: "Missing tenant_id or confirm_name" }, { status: 400 });
    }
    const supabase = createServiceRoleClient();
    const { data: tenant } = await supabase.from("tenants").select("id, name, status").eq("id", tenant_id).single();
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if (String(confirm_name).trim() !== tenant.name) {
      return NextResponse.json({ error: "name_mismatch" }, { status: 400 });
    }

    // Backup first; surface the failure but don't block archiving.
    let signedUrl: string | null = null;
    let exportPath: string | undefined;
    let exportError: string | undefined;
    try {
      const data = await buildTenantExport(supabase, tenant_id);
      const up = await uploadTenantExport(supabase, tenant_id, data);
      signedUrl = up.signedUrl; exportPath = up.path;
    } catch (e: any) { exportError = e?.message || "export failed"; }

    const { purge_after } = await archiveTenant(supabase, tenant_id, { exportPath });

    await logAuditEvent({
      tenant_id, action: "tenant.archived", entity_id: tenant_id, source: "staff",
      agent_id: auth.userId, details: { purge_after, export_path: exportPath ?? null, export_error: exportError ?? null },
    });
    return NextResponse.json({ ok: true, purge_after, download_url: signedUrl, export_error: exportError ?? null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Restore route** — `src/app/api/admin/tenant/restore/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { restoreTenant } from "@/lib/tenants/delete-tenant";
import { logAuditEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const { tenant_id } = await req.json();
    if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });
    const supabase = createServiceRoleClient();
    const { status } = await restoreTenant(supabase, tenant_id);
    await logAuditEvent({
      tenant_id, action: "tenant.restored", entity_id: tenant_id, source: "staff",
      agent_id: auth.userId, details: { status },
    });
    return NextResponse.json({ ok: true, status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Purge route (immediate manual)** — `src/app/api/admin/tenant/purge/route.ts`. The durable record is a `system_logs` insert with `tenant_id: null` (the tenant row — and any audit_events for it — is gone):

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { purgeTenant } from "@/lib/tenants/delete-tenant";
import { logSystemEvent } from "@/lib/system-log";

export async function POST(req: NextRequest) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const { tenant_id, confirm_name } = await req.json();
    if (!tenant_id || !confirm_name) {
      return NextResponse.json({ error: "Missing tenant_id or confirm_name" }, { status: 400 });
    }
    const supabase = createServiceRoleClient();
    const { data: tenant } = await supabase.from("tenants").select("id, name").eq("id", tenant_id).single();
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if (String(confirm_name).trim() !== tenant.name) {
      return NextResponse.json({ error: "name_mismatch" }, { status: 400 });
    }

    const result = await purgeTenant(supabase, tenant_id);
    await logSystemEvent({
      tenant_id: null, category: "system", severity: "medium",
      title: `Tenant purged (manual): ${result.tenantName}`,
      description: `by ${auth.userId}`,
      metadata: { tenant_id, by: auth.userId, ...result },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Archived-list route** — `src/app/api/admin/archived-tenants/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";

export async function GET() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("tenants")
    .select("id, name, archived_at, purge_after")
    .eq("status", "archived")
    .order("archived_at", { ascending: false });
  return NextResponse.json({ archived: data || [] });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/tenant/archive src/app/api/admin/tenant/restore src/app/api/admin/tenant/purge src/app/api/admin/archived-tenants
git commit -m "feat(admin): archive/restore/purge + archived-tenants API routes"
```

---

## Task 9: Guard the status dropdown + hide archived from overview

**Files:**
- Modify: `src/app/api/admin/tenant/route.ts`
- Modify: `src/app/api/admin/overview/route.ts`

- [ ] **Step 1: Block setting `archived` via PATCH** — in `src/app/api/admin/tenant/route.ts`:

Change the import line:
```ts
import { isTenantStatus } from "@/lib/tenants/status";
```
to:
```ts
import { isAdminSettableStatus } from "@/lib/tenants/status";
```
And replace the status validation:
```ts
    if (status !== undefined && !isTenantStatus(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
```
with:
```ts
    if (status !== undefined && !isAdminSettableStatus(status)) {
      // 'archived' is reachable only through the protected archive flow.
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
```

- [ ] **Step 2: Exclude archived from the overview list** — in `src/app/api/admin/overview/route.ts`:

Change the tenants query select to include `status`:
```ts
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id, name, settings, created_at");
```
to:
```ts
    const { data: allTenants } = await supabase
      .from("tenants")
      .select("id, name, settings, created_at, status");
    // Archived tenants disappear from the CRM immediately (recoverable via the
    // Archived section on the admin page).
    const tenants = (allTenants || []).filter((t: any) => t.status !== "archived");
```
The existing `if (!tenants || tenants.length === 0)` guard and all downstream `tenants.*` usage stay unchanged.

- [ ] **Step 3: Run the invariants + status suites** (sanity, no behavior regressions):

Run: `npx vitest run src/lib/saas-invariants.test.ts src/lib/tenants/status.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/tenant/route.ts src/app/api/admin/overview/route.ts
git commit -m "feat(admin): block manual 'archived' status; hide archived tenants from overview"
```

---

## Task 10: Vercel Cron — daily auto-purge endpoint

**Files:**
- Create: `src/app/api/cron/purge-tenants/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Cron endpoint** — `src/app/api/cron/purge-tenants/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { purgeTenant } from "@/lib/tenants/delete-tenant";
import { logSystemEvent } from "@/lib/system-log";

// Daily cron (vercel.json). Vercel sends `Authorization: Bearer ${CRON_SECRET}`.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServiceRoleClient();
  const { data: due } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("status", "archived")
    .lte("purge_after", new Date().toISOString());

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const t of due || []) {
    try {
      const r = await purgeTenant(supabase, t.id);
      await logSystemEvent({
        tenant_id: null, category: "system", severity: "medium",
        title: `Tenant purged (auto): ${r.tenantName}`,
        metadata: { tenant_id: t.id, ...r },
      });
      results.push({ id: t.id, ok: true });
    } catch (e: any) {
      await logSystemEvent({
        tenant_id: null, category: "system", severity: "high",
        title: `Tenant purge failed: ${t.name}`,
        metadata: { tenant_id: t.id, error: e?.message },
      });
      results.push({ id: t.id, ok: false, error: e?.message });
    }
  }
  return NextResponse.json({ checked: (due || []).length, purged: results.filter((r) => r.ok).length, results });
}
```

- [ ] **Step 2: `vercel.json`** at repo root (03:00 UTC daily):

```json
{
  "crons": [
    { "path": "/api/cron/purge-tenants", "schedule": "0 3 * * *" }
  ]
}
```

- [ ] **Step 3: Set the secrets on Vercel** (token + project from memory `credentials.md`). `CRON_SECRET` (Vercel injects it into the cron request) and `RETELL_API_KEY` (for legacy voice teardown):

```bash
# generate a CRON_SECRET
CRON_SECRET=$(openssl rand -hex 24)
# add to production env (Vercel CLI uses VERCEL_TOKEN from memory)
printf "%s" "$CRON_SECRET" | vercel env add CRON_SECRET production --token <VERCEL_TOKEN>
printf "%s" "<RETELL_API_KEY>" | vercel env add RETELL_API_KEY production --token <VERCEL_TOKEN>
# print the secret so the live test (Task 13) can call the endpoint
echo "CRON_SECRET=$CRON_SECRET"
```
> If the CLI prompts for project link, run `vercel link --project crm --yes --token …` first (project id `prj_JESTXIqSA00nYZes02wgD50ozPWV`, team `team_WNPcR4qfWXS1Y3CVFcGefr3c`). Also add both vars to a local `.env.local` so the dev-server live test works.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/purge-tenants/route.ts vercel.json
git commit -m "feat(cron): daily Vercel cron to purge tenants past their grace period"
```

---

## Task 11: Admin UI — Danger Zone + Archived section

> Keep the visual language identical to the existing admin (`cardStyle`, `#c4956a` accents, the existing badge palette). This is an internal danger-zone, so no new design system is needed — but keep accessible focus/disabled states and clear destructive styling (red). The confirm modal requires typing the EXACT tenant name to enable the destructive button.

**Files:**
- Modify: `src/app/(dashboard)/admin/tenant/[id]/page.tsx`
- Modify: `src/app/(dashboard)/admin/page.tsx`

- [ ] **Step 1: Add the archived badge + status type awareness** — in `tenant/[id]/page.tsx`, extend `STATUS_BADGE`:

```ts
const STATUS_BADGE: Record<TenantStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trial: "bg-blue-50 text-blue-700 border-blue-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  suspended: "bg-red-50 text-red-700 border-red-200",
  archived: "bg-zinc-100 text-zinc-600 border-zinc-300",
};
```
Add `archived_at` / `purge_after` to the `TenantDetail.tenant` shape:
```ts
  tenant: { id: string; name: string; status: TenantStatus; created_at: string; archived_at?: string | null; purge_after?: string | null };
```
And include them in the GET response — in `src/app/api/admin/tenant/route.ts`, extend the returned `tenant` object (the GET already selects `settings`; also select `archived_at, purge_after`):
change the select `"id, name, status, settings, created_at"` → `"id, name, status, settings, created_at, archived_at, purge_after"`, and the response `tenant: { id, name, status, created_at }` → add `archived_at: tenant.archived_at, purge_after: tenant.purge_after`.

- [ ] **Step 2: Add a typed-name confirm modal + Danger Zone** to `tenant/[id]/page.tsx`. Add state near the other `useState`s:

```ts
  const [danger, setDanger] = useState<null | "archive" | "purge">(null);
  const [confirmText, setConfirmText] = useState("");
  const [working, setWorking] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
```
Add the action handlers (inside the component):

```ts
  const runArchive = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/archive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, confirm_name: confirmText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setDownloadUrl(j.download_url || null);
      setActionMsg(`Archiviato. Cancellazione definitiva il ${new Date(j.purge_after).toLocaleDateString()}.`);
      setData((p) => (p ? { ...p, tenant: { ...p.tenant, status: "archived" } } : p));
      setDanger(null); setConfirmText("");
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };
  const runPurge = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/purge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, confirm_name: confirmText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setActionMsg("Cliente cancellato definitivamente.");
      setDanger(null); setConfirmText("");
      setTimeout(() => { window.location.href = "/admin"; }, 1200);
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };
  const runRestore = async () => {
    setWorking(true); setActionMsg(null);
    try {
      const res = await fetch("/api/admin/tenant/restore", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setActionMsg("Ripristinato.");
      setData((p) => (p ? { ...p, tenant: { ...p.tenant, status: j.status } } : p));
    } catch (e: any) { setActionMsg(e.message); }
    setWorking(false);
  };
```
Render a Danger Zone block at the BOTTOM of the returned JSX (just before the final closing `</div>`), and disable the status `<select>` when archived (add `|| tenant.status === "archived"` to its `disabled`):

```tsx
      {/* Danger Zone — platform_admin only (page already gates) */}
      <div className="rounded-xl border-2 border-red-300 bg-red-50/60 p-4 space-y-3">
        <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
          <AlertTriangle className="w-4 h-4" /> Danger Zone
        </div>

        {actionMsg && <p className="text-xs font-medium text-black">{actionMsg}</p>}
        {downloadUrl && (
          <a href={downloadUrl} className="text-xs font-bold text-blue-700 underline" target="_blank" rel="noreferrer">
            ⬇︎ Scarica il backup dei dati (JSON)
          </a>
        )}

        {tenant.status === "archived" ? (
          <div className="space-y-2">
            <p className="text-xs text-black">
              Archiviato{tenant.archived_at ? ` il ${new Date(tenant.archived_at).toLocaleDateString()}` : ""}.
              {tenant.purge_after ? ` Cancellazione automatica il ${new Date(tenant.purge_after).toLocaleDateString()}.` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={runRestore} disabled={working}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                Ripristina
              </button>
              <button onClick={() => { setDanger("purge"); setConfirmText(""); }} disabled={working}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
                Cancella adesso definitivamente
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setDanger("archive"); setConfirmText(""); }} disabled={working}
              className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 disabled:opacity-50">
              Archivia &amp; rimuovi (recuperabile 30 giorni)
            </button>
            <button onClick={() => { setDanger("purge"); setConfirmText(""); }} disabled={working}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
              Cancella subito (salta l'attesa)
            </button>
          </div>
        )}
      </div>

      {/* Typed-name confirm modal */}
      {danger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !working && setDanger(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {danger === "archive" ? "Archivia e rimuovi" : "Cancella definitivamente"}
            </h3>
            <p className="text-xs text-black">
              {danger === "archive"
                ? "Il cliente sparisce subito dal CRM e i suoi servizi si fermano. Recuperabile per 30 giorni, poi cancellato per sempre."
                : "Cancellazione IMMEDIATA e irreversibile: dati, workflow n8n, assistente vocale e accessi staff. Esiste un backup scaricabile."}
            </p>
            <p className="text-xs text-black">Scrivi il nome esatto del ristorante per confermare: <b>{tenant.name}</b></p>
            <input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              className="w-full border-2 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
              style={{ borderColor: "#fca5a5" }} placeholder={tenant.name} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setDanger(null)} disabled={working}
                className="px-3 py-1.5 rounded-lg border text-xs font-bold text-black disabled:opacity-50">Annulla</button>
              <button
                onClick={danger === "archive" ? runArchive : runPurge}
                disabled={working || confirmText.trim() !== tenant.name}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50">
                {working ? "..." : (danger === "archive" ? "Archivia" : "Cancella per sempre")}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Add the "Archiviati" section to the admin list page** — in `src/app/(dashboard)/admin/page.tsx`, add state + fetch and render a section above the "All Tenants" table:

```ts
  const [archived, setArchived] = useState<Array<{ id: string; name: string; archived_at: string; purge_after: string }>>([]);
  const fetchArchived = async () => {
    try {
      const res = await fetch("/api/admin/archived-tenants");
      if (res.ok) setArchived((await res.json()).archived || []);
    } catch { /* non-blocking */ }
  };
```
Add `fetchArchived();` to the existing `useEffect(() => { fetchData(); fetchPendingWa(); }, [])` body. Then render (place above the "Tenant Table" block):

```tsx
      {archived.length > 0 && (
        <div className="rounded-xl border-2 border-zinc-300 bg-zinc-50 p-4 space-y-2">
          <h2 className="text-sm font-bold text-zinc-700 uppercase tracking-wider">Archiviati ({archived.length})</h2>
          <div className="space-y-2">
            {archived.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-semibold text-black">{a.name}</span>
                  <span className="text-xs text-zinc-500 block sm:inline sm:ml-2">
                    cancellazione il {new Date(a.purge_after).toLocaleDateString()}
                  </span>
                </div>
                <Link href={`/admin/tenant/${a.id}`} className="text-xs font-bold text-[#c4956a] hover:text-[#8b6540] flex-shrink-0">
                  Gestisci →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/admin/tenant/[id]/page.tsx" "src/app/(dashboard)/admin/page.tsx" src/app/api/admin/tenant/route.ts
git commit -m "feat(admin-ui): tenant Danger Zone (archive/restore/purge) + Archived section"
```

---

## Task 12: Full test loop + production build

**Files:** none (verification)

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS (all suites, including `saas-invariants.test.ts` and the new tenant suites). Fix any regression before moving on.

- [ ] **Step 2: Production build (catches Next 16 / type errors)**

Run: `npm run build`
Expected: build succeeds; the new routes appear in the route manifest. If a dynamic-route/type error surfaces, mirror the existing `src/app/api/admin/tenant/route.ts` handler signature exactly.

- [ ] **Step 3: Commit** (only if any fixups were needed)

```bash
git add -A && git commit -m "test: green unit suite + build for tenant offboarding"
```

---

## Task 13: LIVE end-to-end on Fuoricittà (the real removal)

> This is the real removal of tenant **Fuoricittà** `846033e1-b32a-4ac9-b8c3-43bc18963596`. Do it against a running dev server logged in as the Platform Admin (`admin@baliflow.com`), or by calling the lib through a one-off script with the service-role client. Capture before/after evidence. Its bot bug is irrelevant — we're deleting it.

- [ ] **Step 1: Snapshot BEFORE** — record the live footprint:

```bash
# DB row + child counts
curl -s -X POST "https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query" \
  -H "Authorization: Bearer <SUPABASE_MGMT_TOKEN>" -H "Content-Type: application/json" \
  -d '{"query":"select (select status from tenants where id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"') as status, (select count(*) from knowledge_articles where tenant_id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"') as kb;"}'
# n8n workflows (expect 13 named "[Fuoricittà] …")
curl -s "https://n8n.srv1468837.hstgr.cloud/api/v1/workflows?limit=250" -H "X-N8N-API-KEY: <N8N_API_KEY from credentials.md>" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);ws=d.get('data',d);print('Fuoricittà workflows:',sum(1 for w in ws if w['name'].startswith('[Fuoricittà]')))"
# Retell agent (expect 200)
curl -s -o /dev/null -w "retell agent=%{http_code}\n" "https://api.retellai.com/get-agent/agent_3418785ab580876fe03e59b41e" -H "Authorization: Bearer <RETELL_API_KEY>"
```
Expected: `status=active`, `kb=4`, `Fuoricittà workflows: 13`, `retell agent=200`.

- [ ] **Step 2: ARCHIVE via the UI** — start dev (`npm run dev`), log in as Platform Admin, open `/admin/tenant/846033e1-b32a-4ac9-b8c3-43bc18963596`, click **Archivia & rimuovi**, type `Fuoricittà`, confirm. Verify in the browser:
  - the download link appears → click it, confirm a JSON with `knowledge_articles` length 4 downloads;
  - the message shows the purge date (~30 days out).
- [ ] **Step 3: Verify ARCHIVE side effects (live)**:

```bash
# status archived + purge_after set
curl -s -X POST "https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query" \
  -H "Authorization: Bearer <SUPABASE_MGMT_TOKEN>" -H "Content-Type: application/json" \
  -d '{"query":"select status, archived_at, purge_after, settings->'"'"'archive'"'"' as archive from tenants where id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"';"}'
# n8n workflows now INACTIVE (deactivated, not deleted)
curl -s "https://n8n.srv1468837.hstgr.cloud/api/v1/workflows?limit=250" -H "X-N8N-API-KEY: <key>" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);ws=d.get('data',d);act=[w['name'] for w in ws if w['name'].startswith('[Fuoricittà]') and w.get('active')];print('still active:',act)"
```
Expected: `status=archived`, `purge_after` ~30 days out, `archive.prev_status=active`, `still active: []`. Also confirm Fuoricittà no longer appears in the `/admin` overview list, and DOES appear under "Archiviati".

- [ ] **Step 4: Test RESTORE round-trip** — click **Ripristina** in the UI; verify status returns to `active`, the workflows reactivate, and it reappears in the overview:

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query" \
  -H "Authorization: Bearer <SUPABASE_MGMT_TOKEN>" -H "Content-Type: application/json" \
  -d '{"query":"select status, archived_at from tenants where id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"';"}'
```
Expected: `status=active`, `archived_at=null`. (Workflows active again.)

- [ ] **Step 5: PURGE for real** — archive again (so a fresh backup exists), then in the Danger Zone click **Cancella adesso definitivamente**, type `Fuoricittà`, confirm. (Equivalent: call `POST /api/admin/tenant/purge` with the body.)

- [ ] **Step 6: Verify NOTHING remains (live)**:

```bash
# DB: tenant row gone + every child table empty for that id
curl -s -X POST "https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query" \
  -H "Authorization: Bearer <SUPABASE_MGMT_TOKEN>" -H "Content-Type: application/json" \
  -d '{"query":"select (select count(*) from tenants where id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"') as tenant, (select count(*) from knowledge_articles where tenant_id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"') as kb, (select count(*) from reservations where tenant_id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"') as reservations, (select count(*) from bot_fixes where tenant_id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"') as bot_fixes, (select count(*) from webhook_events where tenant_id='"'"'846033e1-b32a-4ac9-b8c3-43bc18963596'"'"') as webhook_events;"}'
# n8n: zero Fuoricittà workflows
curl -s "https://n8n.srv1468837.hstgr.cloud/api/v1/workflows?limit=250" -H "X-N8N-API-KEY: <key>" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);ws=d.get('data',d);print('Fuoricittà workflows left:',sum(1 for w in ws if w['name'].startswith('[Fuoricittà]')))"
# Retell: agent + llm + kb gone (404)
curl -s -o /dev/null -w "agent=%{http_code}\n" "https://api.retellai.com/get-agent/agent_3418785ab580876fe03e59b41e" -H "Authorization: Bearer <RETELL_API_KEY>"
curl -s -o /dev/null -w "llm=%{http_code}\n" "https://api.retellai.com/get-retell-llm/llm_d31b881f3f946d998e704f211906" -H "Authorization: Bearer <RETELL_API_KEY>"
# durable audit record survived (tenant_id null)
curl -s -X POST "https://api.supabase.com/v1/projects/azhlnybiqlkbhbboyvud/database/query" \
  -H "Authorization: Bearer <SUPABASE_MGMT_TOKEN>" -H "Content-Type: application/json" \
  -d '{"query":"select title, severity, created_at from system_logs where tenant_id is null and title ilike '"'"'%purged%Fuoricittà%'"'"' order by created_at desc limit 1;"}'
```
Expected: `tenant=0`, all child counts `0`, `Fuoricittà workflows left: 0`, `agent=404`, `llm=404`, and the durable `system_logs` "Tenant purged …" row present. The export JSON remains in the `tenant-exports` bucket.

- [ ] **Step 7: Verify the cron endpoint guards** (no live purge — just auth):

```bash
# wrong/no secret → 401
curl -s -o /dev/null -w "no-auth=%{http_code}\n" "http://localhost:3000/api/cron/purge-tenants"
# correct secret → 200 with checked/purged counts (nothing due → purged:0)
curl -s "http://localhost:3000/api/cron/purge-tenants" -H "Authorization: Bearer $CRON_SECRET"
```
Expected: `no-auth=401`; authorized call returns `{ "checked": …, "purged": 0, … }`.

- [ ] **Step 8: Cleanup test artifacts** — none to remove in the DB (Fuoricittà is intentionally gone). Stop the dev server. The `tenant-exports/846033e1-…` backups are intentional and kept.

---

## Task 14: Deploy + ship

**Files:** none

- [ ] **Step 1: Push main** (auto-deploys via Vercel):

```bash
git push origin main
```

- [ ] **Step 2: Confirm the cron is registered** — after deploy, check the Vercel project's Cron Jobs shows `/api/cron/purge-tenants` daily at `0 3 * * *`. Hit it once in production with the secret to confirm a 200:

```bash
curl -s "https://<prod-domain>/api/cron/purge-tenants" -H "Authorization: Bearer $CRON_SECRET"
```
Expected: `{ "checked": 0, "purged": 0, ... }` (no archived tenants due yet).

---

## Self-Review

**Spec coverage:**
- Archive (immediate hide + no traffic, recoverable ~30d) → Task 7 `archiveTenant` (status=archived not in `TRAFFIC_ALLOWED_STATUSES`; deactivates n8n; hidden via Task 9 overview filter). ✅
- Auto-purge after grace period → Task 10 cron + `computePurgeAfter` (30 days, confirmed). ✅
- Manual "delete now" → Task 8 purge route + Task 11 UI. ✅
- Restore during grace → Task 7 `restoreTenant` + Task 8 route + Task 11 UI. ✅
- platform_admin only → every route uses `assertPlatformAdmin`; cron uses `CRON_SECRET`. ✅
- Typed-name confirm modal → Task 11 modal + server-side `name_mismatch` check (Task 8). ✅
- Audit every action → archive/restore via `logAuditEvent`; purge via durable `system_logs` (tenant_id null, survives cascade). ✅
- Export before permanent delete (Storage + download) → Task 6 + Task 8 (archive exports & returns link; purge re-exports). ✅ (decision: bucket + signed URL).
- Teardown n8n (deactivate+delete, stored ids ∪ name prefix) → Tasks 4/5/7. ✅
- Teardown voice (Vapi AND legacy Retell) → Tasks 4/5/7 (provider-aware, confirmed decision). ✅
- Twilio → no per-tenant resource to release (string only); sandbox tenants have nothing — handled by doing nothing, documented. ✅
- Disable staff logins without touching other tenants / platform_admins → Task 4 `classifyStaffForTeardown` + Task 7 `resolveStaffPlan`. ✅
- Cascade 15 tables + manual orphans (bot_fixes, trello_synced_audits, webhook_events) + bot_sessions by phone → Task 7. ✅
- status.ts single source of truth → Task 2. ✅
- delete-tenant.ts mirrors create-tenant.ts → Task 7. ✅
- Don't violate saas-invariants → Task 9 Step 3 + Task 12 run them; new code hardcodes none of the banned values. ✅
- Work on main, no feature branch → all commits to main, push in Task 14. ✅
- Scheduler proposed + implemented (Vercel Cron) → Task 10. ✅
- Fuoricittà live end-to-end → Task 13. ✅

**Placeholder scan:** No TBD/TODO; every code step has full code; every command has expected output. ✅

**Type consistency:** `PurgeDeps`/`PurgeResult`/`VoiceTeardownPlan`/`StaffPlan`/`StaffMember` defined in Tasks 4/7 and used consistently; `n8nWorkflowIdsToRemove`, `voiceTeardownPlan`, `classifyStaffForTeardown`, `botSessionPhonesToClean`, `archiveTenant`, `restoreTenant`, `purgeTenant`, `computePurgeAfter`, `buildTenantExport`, `uploadTenantExport`, `EXPORT_BUCKET`, `isAdminSettableStatus` names match across tasks. `webhook_events.tenant_id` treated as text (string id passed). ✅
