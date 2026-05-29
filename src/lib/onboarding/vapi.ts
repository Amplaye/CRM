// Vapi provisioning helpers.
//
// SaaS model: every new tenant gets a CLONE of the agency's golden-source
// template assistant ("PICNIC - Sofía"). We reuse the template's voice, model
// and tools verbatim — only the name, the system prompt and the first message
// change per tenant. There is NO separate knowledge base on Vapi: the published
// KB articles are concatenated into the assistant's system prompt, after the
// voice prompt (see composeVapiSystemPrompt).
//
// The voicemail route (api/sync-vapi-voicemail) maintains a delimited block in
// the SAME system prompt. A KB sync must NEVER wipe it, so composeVapiSystemPrompt
// extracts and preserves whatever sits between the VOICEMAIL_BLOCK delimiters.

const VAPI_BASE = "https://api.vapi.ai";

// Hard timeout on every Vapi call. A hung request here would otherwise keep the
// onboarding SSE stream open forever, leaving the wizard stuck on the loading
// screen (the "loaded to infinity" report). On timeout we surface a labelled
// error so the run fails cleanly with a visible reason instead of hanging.
async function vfetch(url: string, init: RequestInit = {}, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`Vapi request timed out after ${ms / 1000}s: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

// The golden-source template assistant cloned for every tenant. Overridable for
// testing via VAPI_TEMPLATE_ASSISTANT_ID; defaults to the live "PICNIC - Sofía".
export const TEMPLATE_VAPI_ASSISTANT_ID =
  process.env.VAPI_TEMPLATE_ASSISTANT_ID || "6c92f776-abb2-4175-8a55-45d76ec01d1a";

// Must match the delimiters used by api/sync-vapi-voicemail so a KB sync and a
// voicemail sync coexist in the same system prompt without clobbering each other.
const VM_BLOCK_START = "<!-- VOICEMAIL_BLOCK_START -->";
const VM_BLOCK_END = "<!-- VOICEMAIL_BLOCK_END -->";

// The concatenated published KB articles live between these delimiters so future
// syncs can find and replace the block cleanly.
const KB_BLOCK_START = "<!-- KB_BLOCK_START -->";
const KB_BLOCK_END = "<!-- KB_BLOCK_END -->";

// Vapi assistant fields the API rejects on create (server-managed / read-only).
const READ_ONLY_FIELDS = ["id", "orgId", "createdAt", "updatedAt", "isServerUrlSecretSet"];

export interface VapiKbArticle {
  title: string;
  content: string;
  category: string;
}

// Special article title: any case/punctuation variant of "VOICEPROMPT"
// (e.g. "VOICE PROMPT", "voice-prompt", "voicePrompt") marks the article as the
// agent's voice prompt body instead of a KB source. Existing tenants already
// store their voice prompt under this title, so the match stays permissive.
export function isPromptArticle(title: string): boolean {
  return (title || "").toUpperCase().replace(/[^A-Z]/g, "") === "VOICEPROMPT";
}

function extractVmBlock(prompt: string): string | null {
  if (!prompt) return null;
  const s = prompt.indexOf(VM_BLOCK_START);
  if (s === -1) return null;
  const e = prompt.indexOf(VM_BLOCK_END, s);
  if (e === -1) return null;
  return prompt.slice(s, e + VM_BLOCK_END.length);
}

function formatKbArticle(a: VapiKbArticle): string {
  return `[${(a.category || "general").toUpperCase()}] ${a.title}\n${(a.content || "").trim()}`;
}

export interface ComposeInput {
  voicePromptBody: string;
  kbArticles: VapiKbArticle[];
  /** The assistant's current system prompt — used only to preserve the VM block. */
  existingPrompt?: string;
}

/**
 * Pure: build the assistant system prompt as
 *   [voicemail block, if present in existingPrompt] + voice prompt + KB block.
 * The voicemail block (if any) is carried over verbatim so a KB sync never wipes
 * the voicemail control the api/sync-vapi-voicemail route owns in the same prompt.
 */
export function composeVapiSystemPrompt({ voicePromptBody, kbArticles, existingPrompt }: ComposeInput): string {
  const parts: string[] = [];

  const vm = extractVmBlock(existingPrompt || "");
  if (vm) parts.push(vm);

  const voice = (voicePromptBody || "").trim();
  if (voice) parts.push(voice);

  const published = (kbArticles || []).filter((a) => a && a.title && (a.content || "").trim());
  if (published.length) {
    const body = published.map(formatKbArticle).join("\n\n");
    parts.push(`${KB_BLOCK_START}\n# KNOWLEDGE BASE\n\n${body}\n${KB_BLOCK_END}`);
  }

  return parts.join("\n\n");
}

// --- Vapi REST helpers ---------------------------------------------------------

function authHeaders(key: string, json = false): Record<string, string> {
  return json
    ? { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }
    : { Authorization: `Bearer ${key}` };
}

// Strip the properties Vapi's validator names in a 400 ("property X should not
// exist"). Returns the keys removed so the caller can decide whether to retry.
function stripDisallowed(payload: Record<string, any>, messages: unknown): string[] {
  const removed: string[] = [];
  const list = Array.isArray(messages) ? messages : [messages];
  for (const m of list) {
    const match = /property (\w+) should not exist/i.exec(String(m || ""));
    if (match && match[1] in payload) {
      delete payload[match[1]];
      removed.push(match[1]);
    }
  }
  return removed;
}

function setSystemMessage(model: any, systemPrompt: string): any {
  const messages = Array.isArray(model?.messages) ? [...model.messages] : [];
  const sysIdx = messages.findIndex((m: any) => m?.role === "system");
  if (sysIdx >= 0) messages[sysIdx] = { ...messages[sysIdx], content: systemPrompt };
  else messages.unshift({ role: "system", content: systemPrompt });
  return { ...model, messages };
}

// The golden-source template ("PICNIC - Sofía") wires its voice tools to n8n
// webhooks named `picnic-*` (e.g. /webhook/picnic-book). Those paths resolve to
// PICNIC's tenant_id, so a verbatim clone would route every new tenant's
// bookings into Picnic's CRM. Instead we point clones at the shared
// multi-tenant workflow ([ALL] Voice Agent Webhooks — Multi-Tenant), whose
// `tenant-voice-*` paths resolve the tenant dynamically from the calling
// assistant id. The template stays on `picnic-*`; only clones are repointed.
const VOICE_WEBHOOK_PATH_MAP: Record<string, string> = {
  "picnic-check-slots": "tenant-voice-check-slots",
  "picnic-book": "tenant-voice-book",
  "picnic-modify": "tenant-voice-modify",
  "picnic-cancel": "tenant-voice-cancel",
  "picnic-waitlist": "tenant-voice-waitlist",
  "picnic-update-notes": "tenant-voice-update-notes",
  "picnic-post-call": "tenant-voice-post-call",
};

function remapWebhookUrl(url: unknown): unknown {
  if (typeof url !== "string") return url;
  for (const [from, to] of Object.entries(VOICE_WEBHOOK_PATH_MAP)) {
    if (url.endsWith(`/${from}`)) return url.slice(0, -from.length) + to;
  }
  return url;
}

// Repoint a cloned assistant's tool server URLs (and the top-level serverUrl)
// from the template's `picnic-*` webhooks to the shared `tenant-voice-*` ones.
// Mutates a shallow-cloned copy; safe to call on the raw template payload.
export function repointVoiceWebhooks(payload: Record<string, any>): Record<string, any> {
  const out = { ...payload };
  if ("serverUrl" in out) out.serverUrl = remapWebhookUrl(out.serverUrl);
  const model = out.model;
  if (model && Array.isArray(model.tools)) {
    out.model = {
      ...model,
      tools: model.tools.map((t: any) => {
        if (t?.server?.url) {
          return { ...t, server: { ...t.server, url: remapWebhookUrl(t.server.url) } };
        }
        return t;
      }),
    };
  }
  return out;
}

export interface CloneInput {
  key: string;
  name: string;
  systemPrompt: string;
  firstMessage?: string;
  templateId?: string;
}

/**
 * Clone the template assistant: GET it, strip read-only fields, then POST the
 * rest with a new name + system prompt (+ first message). On a 400 we strip the
 * fields Vapi flags as disallowed and retry, so the clone is resilient to the
 * API's read-only set drifting.
 */
export async function cloneTemplateAssistant({
  key,
  name,
  systemPrompt,
  firstMessage,
  templateId,
}: CloneInput): Promise<{ assistantId: string }> {
  const id = templateId || TEMPLATE_VAPI_ASSISTANT_ID;

  const getRes = await vfetch(`${VAPI_BASE}/assistant/${id}`, { headers: authHeaders(key) });
  if (!getRes.ok) {
    throw new Error(`Vapi GET template ${id} -> ${getRes.status}: ${(await getRes.text()).slice(0, 300)}`);
  }
  const template = await getRes.json();

  let payload: Record<string, any> = { ...template };
  for (const f of READ_ONLY_FIELDS) delete payload[f];
  payload.name = name;
  payload.model = setSystemMessage(template.model, systemPrompt);
  if (firstMessage !== undefined) payload.firstMessage = firstMessage;
  // Route the clone's voice tools to the shared multi-tenant webhooks so its
  // bookings land in THIS tenant's CRM, not the template's (Picnic). Without
  // this, a verbatim clone inherits the `picnic-*` URLs and misroutes.
  payload = repointVoiceWebhooks(payload);

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await vfetch(`${VAPI_BASE}/assistant`, {
      method: "POST",
      headers: authHeaders(key, true),
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (res.ok) {
      const created = JSON.parse(text);
      if (!created?.id) throw new Error(`Vapi POST /assistant: no id returned`);
      return { assistantId: created.id };
    }
    if (res.status === 400) {
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* non-JSON 400 */ }
      const removed = stripDisallowed(payload, data?.message);
      if (removed.length) continue; // drop the offending field(s) and retry
    }
    throw new Error(`Vapi POST /assistant -> ${res.status}: ${text.slice(0, 400)}`);
  }
  throw new Error("Vapi POST /assistant: gave up after stripping fields on repeated 400s");
}

/**
 * Find an existing assistant by exact name. Used to make provisioning
 * idempotent: if a previous (truncated) run already cloned the assistant but the
 * tenant row never recorded its id, a retry can recover it instead of leaking a
 * second clone. Returns the newest match's id, or null.
 */
export async function findAssistantByName(
  key: string,
  name: string
): Promise<string | null> {
  const res = await vfetch(`${VAPI_BASE}/assistant?limit=100`, { headers: authHeaders(key) });
  if (!res.ok) return null; // best-effort: a failed lookup must not block provisioning
  let list: any;
  try { list = await res.json(); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const matches = list
    .filter((a) => a && a.name === name && a.id)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return matches.length ? matches[0].id : null;
}

export interface SyncPromptInput {
  key: string;
  assistantId: string;
  voicePromptBody: string;
  kbArticles: VapiKbArticle[];
}

/**
 * Sync the assistant's system prompt from the tenant's voice prompt + KB
 * articles. GETs the current prompt (to preserve the voicemail block), composes
 * the new one, and PATCHes only if it changed.
 */
export async function syncAssistantPrompt({
  key,
  assistantId,
  voicePromptBody,
  kbArticles,
}: SyncPromptInput): Promise<{ changed: boolean; promptChars: number }> {
  const getRes = await vfetch(`${VAPI_BASE}/assistant/${assistantId}`, { headers: authHeaders(key) });
  if (!getRes.ok) {
    throw new Error(`Vapi GET assistant ${assistantId} -> ${getRes.status}: ${(await getRes.text()).slice(0, 300)}`);
  }
  const assistant = await getRes.json();

  const messages = Array.isArray(assistant?.model?.messages) ? assistant.model.messages : [];
  const sysIdx = messages.findIndex((m: any) => m?.role === "system");
  const existingPrompt: string = sysIdx >= 0 ? messages[sysIdx].content || "" : "";

  const newPrompt = composeVapiSystemPrompt({ voicePromptBody, kbArticles, existingPrompt });
  if (newPrompt === existingPrompt) return { changed: false, promptChars: newPrompt.length };

  const patchRes = await vfetch(`${VAPI_BASE}/assistant/${assistantId}`, {
    method: "PATCH",
    headers: authHeaders(key, true),
    body: JSON.stringify({ model: setSystemMessage(assistant.model, newPrompt) }),
  });
  if (!patchRes.ok) {
    throw new Error(`Vapi PATCH assistant ${assistantId} -> ${patchRes.status}: ${(await patchRes.text()).slice(0, 400)}`);
  }
  return { changed: true, promptChars: newPrompt.length };
}

export async function deleteAssistant(assistantId: string, key: string): Promise<void> {
  const res = await fetch(`${VAPI_BASE}/assistant/${assistantId}`, {
    method: "DELETE",
    headers: authHeaders(key),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Vapi DELETE assistant ${assistantId} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
