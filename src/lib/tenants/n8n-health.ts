// "Verità viva" n8n health — derive a tenant's automation state from what is
// ACTUALLY on n8n right now, never from a hardcoded count or template list.
//
// Why this exists: the old health card counted a tenant's active `[Name]`
// workflows against a magic number (N8N_TEMPLATE_COUNT=14) and a floor (9). But
// real tenants run anywhere from 6 to 13 own workflows depending on when they
// were onboarded and how much got consolidated into shared `[ALL]` engines —
// PICNIC, the "gold standard" the number was derived from, runs only 6/17. So
// any single threshold is wrong for someone, and every time n8n changes
// (a workflow consolidated, renamed, a new shared engine added) the admin drifts
// out of sync and shows a phantom mismatch like Oraz's "10/14 incompleto".
//
// This module instead reports, per workflow, one of three states:
//   - "active":  the tenant's own `[Name] X` workflow is live → it works.
//   - "covered": the own copy is OFF, but a live shared engine (`[ALL] X …` or a
//                known platform endpoint) performs that function for every tenant
//                → intended, not a fault. (Re-activating it would double-send.)
//   - "down":    the own copy is OFF and nothing covers it → a real problem.
//
// "covered" is computed from the live `[ALL]`/`[Meta Router]` workflows present
// on n8n, NOT from a constant. Add or remove a shared engine on n8n and the
// admin adjusts itself — no code change, no list to maintain. The only shared
// convention left is the function name in the workflow title (the suffix after
// the `[Prefix]`), which is what couples `[Oraz] Reminders` to
// `[ALL] Reminders — Multi-Tenant`.

export interface RawWorkflow {
  name?: string;
  active?: boolean;
  id?: string;
}

// "optional" = an own workflow that is OFF and not covered by a shared engine,
// but performs an ACCESSORY function (a report, a nightly audit, a summary) that
// a restaurant can legitimately run without. The reference tenant PICNIC keeps
// several of these off by design — flagging them red would make every healthy
// tenant look broken. Only CORE functions (the ones that make the bot actually
// answer) become "down"/red when missing.
export type WorkflowState = "active" | "covered" | "optional" | "down";

export interface TenantWorkflow {
  /** The function name (title with the `[Prefix]` stripped), e.g. "Reminders". */
  func: string;
  /** Full workflow name as it appears on n8n. */
  name: string;
  /** n8n workflow id, for deep-linking. */
  id?: string;
  state: WorkflowState;
  /** When state==="covered", the shared engine that performs this function. */
  coveredBy?: string;
}

export interface N8nTenantHealth {
  /** Every `[TenantName] …` workflow, own state resolved against shared engines. */
  workflows: TenantWorkflow[];
  active: number;
  covered: number;
  /** Accessory workflows off-and-uncovered — fine to ignore, not a fault. */
  optional: number;
  down: number;
  /** ok = no CORE function down; the bot answers. Optional/off doesn't break it. */
  ok: boolean;
}

// Functions served by a CRM endpoint rather than any n8n workflow — so an OFF
// own copy is still "covered" even though no `[ALL]` workflow exists for it.
// Matched against the normalized function name (see normFunc).
const CRM_SERVED_FUNCTIONS = new Set<string>([
  "web call token", // superseded by the CRM /api/voice/overrides endpoint
]);

// CORE functions — the ones that make the bot actually answer a guest. If one of
// these is off AND uncovered, the tenant is genuinely broken (red). Everything
// else (reports, audits, summaries, deflectors, menu pushes) is accessory: a
// restaurant can run without it, so an off-and-uncovered accessory is "optional"
// (grey), not "down" (red). Matched by substring against the normalized func, so
// "voice agent webhooks", "voice tool — menu", "voice tool — restaurant info"
// all count as core. PICNIC (the reference) keeps every accessory off by design.
const CORE_FUNCTION_MARKERS = [
  "voice agent webhook", // inbound voice → the bot
  "voice tool",          // the bot's data tools (menu, restaurant info, …)
  "chatbot",             // WhatsApp/chat engine
];

function isCoreFunction(func: string): boolean {
  return CORE_FUNCTION_MARKERS.some((m) => func.includes(m));
}

// Strip the leading `[Prefix]` and normalize, so titles compare regardless of
// case, accents, em-dash vs hyphen, and the "— Multi-Tenant" suffix that shared
// engines carry. "[ALL] Follow-up Post-Cena — Multi-Tenant" and
// "[Oraz] Follow-up Post-Cena" both normalize to "follow-up post-cena".
export function normFunc(workflowName: string): string {
  let s = workflowName;
  const close = s.indexOf("]");
  if (s.startsWith("[") && close !== -1) s = s.slice(close + 1);
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // drop accents
    .replace(/[—–]/g, "-")                            // unify dashes
    .replace(/\s*-\s*multi-?tenant\s*$/i, "")         // drop shared suffix
    .replace(/[✨🟢🔴⚪]/g, "")                          // drop decorative emoji
    .replace(/\s+/g, " ")
    .trim();
}

// The prefix inside the leading brackets, lowercased. "[Oraz] X" → "oraz".
function prefixOf(name: string): string | null {
  if (!name.startsWith("[")) return null;
  const close = name.indexOf("]");
  if (close === -1) return null;
  return name.slice(1, close).trim().toLowerCase();
}

/**
 * Resolve a single tenant's automation health from the full n8n workflow list.
 *
 * @param tenantName  the tenant's display name; its workflows are `[tenantName] …`
 * @param all         every workflow on n8n (from GET /workflows)
 */
export function resolveN8nTenantHealth(
  tenantName: string,
  all: RawWorkflow[]
): N8nTenantHealth {
  const wantPrefix = tenantName.trim().toLowerCase();

  // Live shared engines: any active workflow under [ALL] or [Meta Router].
  // Map their normalized function → display name, so we can answer "is function
  // F covered by a live shared engine?" purely from current n8n state.
  const sharedLive = new Map<string, string>();
  for (const w of all) {
    const name = typeof w.name === "string" ? w.name : "";
    if (!w.active) continue;
    const px = prefixOf(name);
    if (px === "all" || px === "meta router") {
      sharedLive.set(normFunc(name), name);
    }
  }
  // The Meta Router engine covers the per-tenant "Chatbot WhatsApp" function;
  // its title doesn't contain "chatbot whatsapp", so map it explicitly when live.
  if ([...sharedLive.values()].some((n) => n.toLowerCase().includes("meta router"))) {
    const router = [...sharedLive.entries()].find(([, n]) => n.toLowerCase().includes("meta router"));
    if (router) sharedLive.set("chatbot whatsapp", router[1]);
  }

  // The tenant's OWN workflows (prefix matches the tenant name exactly).
  const own = all.filter((w) => prefixOf(typeof w.name === "string" ? w.name : "") === wantPrefix);

  const workflows: TenantWorkflow[] = own.map((w) => {
    const name = w.name as string;
    const func = normFunc(name);
    if (w.active) {
      return { func, name, id: w.id, state: "active" as const };
    }
    // OFF own copy — is the function covered elsewhere?
    const sharedName = sharedLive.get(func);
    if (sharedName) {
      return { func, name, id: w.id, state: "covered" as const, coveredBy: sharedName };
    }
    if (CRM_SERVED_FUNCTIONS.has(func)) {
      return { func, name, id: w.id, state: "covered" as const, coveredBy: "CRM /api/voice/overrides" };
    }
    // Off and uncovered: red only if it's a CORE function; otherwise accessory.
    return { func, name, id: w.id, state: isCoreFunction(func) ? ("down" as const) : ("optional" as const) };
  });

  // De-dup by function: a tenant may have two `[Name] X` copies (a stale clone +
  // a live one). Keep the best state per function (active > covered > down) so a
  // leftover inactive duplicate doesn't show as "down" when a live copy exists.
  const rank: Record<WorkflowState, number> = { active: 3, covered: 2, optional: 1, down: 0 };
  const byFunc = new Map<string, TenantWorkflow>();
  for (const wf of workflows) {
    const prev = byFunc.get(wf.func);
    if (!prev || rank[wf.state] > rank[prev.state]) byFunc.set(wf.func, wf);
  }
  const deduped = [...byFunc.values()];

  const active = deduped.filter((w) => w.state === "active").length;
  const covered = deduped.filter((w) => w.state === "covered").length;
  const optional = deduped.filter((w) => w.state === "optional").length;
  const down = deduped.filter((w) => w.state === "down").length;

  return { workflows: deduped, active, covered, optional, down, ok: down === 0 && deduped.length > 0 };
}
