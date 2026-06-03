// n8n REST API client — extracted from orchestrator.ts so both onboarding
// (clone workflows) and the post-onboarding contact re-sync (update workflows
// in place) share ONE implementation, env, and timeout. Pure transport: no
// tenant/business logic lives here.

// Every outbound call gets a hard timeout. Without one, a single hung n8n
// request leaves an SSE stream / route open forever (the "loaded to infinity"
// bug). On timeout we throw a labelled error so the caller's log shows WHICH
// call stalled, and the run fails cleanly instead of hanging.
export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`request timed out after ${ms / 1000}s: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

// Generic n8n public-API call. method/path are appended to `${baseUrl}/api/v1`.
// Returns parsed JSON when possible, otherwise the raw text. Throws on non-2xx.
export async function n8n(method: string, path: string, body?: any): Promise<any> {
  const apiKey = process.env.N8N_API_KEY;
  const baseUrl = process.env.N8N_BASE_URL || "https://n8n.srv1468837.hstgr.cloud";
  if (!apiKey) throw new Error("N8N_API_KEY not configured");
  const res = await fetchWithTimeout(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }, 30_000);
  const text = await res.text();
  if (!res.ok) throw new Error(`n8n ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Update a workflow IN PLACE, preserving its id and webhook paths. n8n's public
// API PUT accepts only { name, nodes, connections, settings } (active is
// read-only here — it's toggled via the separate /activate endpoint). The body
// mirrors toCreatePayload's shape.
export async function updateWorkflow(
  id: string,
  payload: { name: string; nodes: any[]; connections: any; settings: any },
): Promise<any> {
  return n8n("PUT", `/workflows/${id}`, payload);
}

// Activate a workflow. n8n deactivates a workflow on PUT in some versions, so
// callers re-activate after an update; activating an already-active workflow is
// a harmless no-op.
export async function activateWorkflow(id: string): Promise<any> {
  return n8n("POST", `/workflows/${id}/activate`);
}
