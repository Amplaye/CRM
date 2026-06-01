// Retell provisioning helpers — the PREMIUM voice tier.
//
// SaaS model (mirrors vapi.ts): the voice agent's behaviour is the AGENCY's
// single golden-source prompt (buildVoicePrompt), NOT something hand-written per
// tenant inside Retell. Both providers consume the SAME prompt body, so a
// tenant's two flows (Vapi base / Retell premium) are identical and switching
// tier is a routing flip, not a rewrite.
//
// Retell splits an agent into an "agent" (voice/model wiring) and a "retell-llm"
// (the conversational brain that holds general_prompt + tools + knowledge base).
// The prompt we own lives in the LLM's `general_prompt`. We update it the same
// way sync-kb-vapi updates Vapi's system message: compose voice prompt + KB,
// PATCH only if it changed.
//
// Date handling: the prompt's header uses the {{current_date}} / {{current_time}}
// / {{tomorrow_date}} placeholders — the SAME tokens Vapi fills from
// variableValues. On Retell these are `retell_llm_dynamic_variables` set by the
// Web Call Token workflow at call time. Because the date now comes from dynamic
// vars, the hourly cron that used to rewrite the Retell header by hand is no
// longer needed for a CRM-generated agent (see the migration notes).

import { composeVapiSystemPrompt, type VapiKbArticle } from "./vapi";

const RETELL_BASE = "https://api.retellai.com";

async function rfetch(url: string, init: RequestInit = {}, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`Retell request timed out after ${ms / 1000}s: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/**
 * Compose the Retell LLM's general_prompt from the tenant's voice prompt body +
 * published KB articles. Reuses composeVapiSystemPrompt so the two providers
 * share ONE composition: voice prompt followed by the KB block. (Retell has no
 * voicemail block in its prompt, so existingPrompt is omitted — composeVapi…
 * simply skips it.) This is the single source of truth for the spoken brain.
 */
export function composeRetellPrompt(voicePromptBody: string, kbArticles: VapiKbArticle[]): string {
  return composeVapiSystemPrompt({ voicePromptBody, kbArticles });
}

export interface SyncRetellPromptInput {
  key: string;
  llmId: string;
  voicePromptBody: string;
  kbArticles: VapiKbArticle[];
}

/**
 * Sync the Retell LLM's general_prompt from the tenant's voice prompt + KB.
 * GETs the current LLM, composes the new prompt, and PATCHes only if it changed.
 * Returns { changed, promptChars } like syncAssistantPrompt does for Vapi.
 *
 * NOTE: a freshly-PATCHed Retell LLM serves the new prompt to NEW calls; if the
 * agent pins a published LLM version, publish the agent afterwards (publishAgent).
 */
export async function syncRetellPrompt({
  key,
  llmId,
  voicePromptBody,
  kbArticles,
}: SyncRetellPromptInput): Promise<{ changed: boolean; promptChars: number }> {
  const getRes = await rfetch(`${RETELL_BASE}/get-retell-llm/${llmId}`, { headers: authHeaders(key) });
  if (!getRes.ok) {
    throw new Error(`Retell GET llm ${llmId} -> ${getRes.status}: ${(await getRes.text()).slice(0, 300)}`);
  }
  const llm = await getRes.json();
  const existing: string = llm?.general_prompt || "";

  const next = composeRetellPrompt(voicePromptBody, kbArticles);
  if (next === existing) return { changed: false, promptChars: next.length };

  const patchRes = await rfetch(`${RETELL_BASE}/update-retell-llm/${llmId}`, {
    method: "PATCH",
    headers: authHeaders(key),
    body: JSON.stringify({ general_prompt: next }),
  });
  if (!patchRes.ok) {
    throw new Error(`Retell PATCH llm ${llmId} -> ${patchRes.status}: ${(await patchRes.text()).slice(0, 400)}`);
  }
  return { changed: true, promptChars: next.length };
}

/**
 * Publish an agent so calls pick up the latest LLM prompt when the agent pins a
 * published version. Best-effort: a 404/already-published is treated as success
 * so a sync never hard-fails on the publish step.
 */
export async function publishRetellAgent(agentId: string, key: string): Promise<void> {
  const res = await rfetch(`${RETELL_BASE}/publish-agent/${agentId}`, {
    method: "POST",
    headers: authHeaders(key),
  });
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    throw new Error(`Retell publish-agent ${agentId} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
