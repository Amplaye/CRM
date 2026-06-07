// Shared HTTP transport for POS adapters — a copy of vapi.ts's vfetch idiom:
// a hard timeout (a hung till API must never wedge the sync cron) plus a
// throw-on-non-2xx so adapters can `await posFetch(...)` and assume success.
// The MockAdapter doesn't use it; the real adapters will.

export async function posFetch(
  url: string,
  init: RequestInit = {},
  ms = 30_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`POS request failed ${res.status} ${res.statusText}: ${url}${body ? ` — ${body.slice(0, 500)}` : ""}`);
    }
    return res;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`POS request timed out after ${ms / 1000}s: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}
