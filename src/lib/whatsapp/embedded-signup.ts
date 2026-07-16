// Server-only helpers for the Meta WhatsApp Embedded Signup onboarding flow.
//
// The browser NEVER receives a long-lived token: the frontend launches
// Embedded Signup via FB.login({ config_id }), gets a short-lived authorization
// `code` + (via the embedded-signup message event) the `waba_id` /
// `phone_number_id`, and POSTs only that to /api/whatsapp/embedded-signup. This
// module does the rest server-side: exchange the code for a token, subscribe our
// app to the WABA's webhooks, and read the owning business id.
//
// Endpoints (Graph API):
//   GET  /oauth/access_token         — code → business access token
//   POST /{waba-id}/subscribed_apps  — subscribe BALI Flow app to the WABA
//   GET  /{waba-id}?fields=owner_business_info, /{waba-id}/phone_numbers

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface ExchangeResult {
  ok: boolean;
  accessToken?: string;
  tokenType?: string;
  /** seconds until expiry, when Meta returns it (long-lived/system tokens omit it) */
  expiresIn?: number;
  error?: string;
}

/** Exchange the Embedded Signup authorization code for a business access token. */
export async function exchangeCodeForToken(code: string): Promise<ExchangeResult> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false, error: "META_APP_ID / META_APP_SECRET not configured" };
  }
  if (!code) return { ok: false, error: "Missing authorization code" };

  const url =
    `${GRAPH}/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&code=${encodeURIComponent(code)}`;

  try {
    const res = await fetch(url, { method: "GET" });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (data?.error as { message?: string })?.message || `Token exchange failed (${res.status})`;
      return { ok: false, error: msg };
    }
    return {
      ok: true,
      accessToken: data.access_token as string | undefined,
      tokenType: data.token_type as string | undefined,
      expiresIn: typeof data.expires_in === "number" ? (data.expires_in as number) : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Subscribe the BALI Flow app to a WABA's webhooks (so we receive its events). */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!wabaId || !token) return { ok: false, error: "Missing waba_id or token" };
  try {
    const res = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (data?.error as { message?: string })?.message || `subscribe_apps failed (${res.status})`;
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface WabaInfo {
  ok: boolean;
  businessId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  error?: string;
}

/**
 * Read the WABA's owner business id, and best-effort the first phone number on
 * it (the Embedded Signup message event usually hands us phone_number_id
 * directly, but we confirm/fill from the API when it doesn't).
 */
export async function fetchWabaInfo(wabaId: string, token: string): Promise<WabaInfo> {
  if (!wabaId || !token) return { ok: false, error: "Missing waba_id or token" };
  try {
    const wabaRes = await fetch(`${GRAPH}/${wabaId}?fields=id,owner_business_info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const waba = (await wabaRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!wabaRes.ok) {
      const msg = (waba?.error as { message?: string })?.message || `WABA fetch failed (${wabaRes.status})`;
      return { ok: false, error: msg };
    }
    const businessId = (waba?.owner_business_info as { id?: string } | undefined)?.id;

    let phoneNumberId: string | undefined;
    let displayPhoneNumber: string | undefined;
    const pnRes = await fetch(`${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pn = (await pnRes.json().catch(() => ({}))) as { data?: Array<{ id?: string; display_phone_number?: string }> };
    if (pnRes.ok && Array.isArray(pn?.data) && pn.data[0]) {
      phoneNumberId = pn.data[0].id;
      displayPhoneNumber = pn.data[0].display_phone_number;
    }
    return { ok: true, businessId, phoneNumberId, displayPhoneNumber };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
