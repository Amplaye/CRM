// Minimal PayPal REST client — no SDK. PayPal subscriptions: OAuth2 client-creds
// for an access token, then create a subscription against a pre-made billing plan
// (PAYPAL_PLAN_* env ids) and redirect the owner to the approval url. Until the
// PAYPAL_CLIENT_ID/SECRET land, `paypalConfigured()` is false and the route 503s.
//
// PAYPAL_ENV = "live" | "sandbox" (default sandbox) picks the API host.

function base(): string {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function paypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function accessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID/SECRET not set");
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error_description || `PayPal auth ${res.status}`);
  return json.access_token;
}

/** Create a subscription against a billing plan id. Returns the subscription id and
 * the approval url the owner must visit to authorise it. `custom_id` carries our
 * tenant_id back through the webhook. */
export async function createSubscription(params: {
  planId: string;
  customId: string; // tenant_id
  returnUrl: string;
  cancelUrl: string;
  subscriberEmail?: string;
}): Promise<{ id: string; approveUrl: string }> {
  const token = await accessToken();
  const res = await fetch(`${base()}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      plan_id: params.planId,
      custom_id: params.customId,
      subscriber: params.subscriberEmail ? { email_address: params.subscriberEmail } : undefined,
      application_context: {
        brand_name: "BALI Flow",
        user_action: "SUBSCRIBE_NOW",
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || `PayPal subscription ${res.status}`);
  const approve = (json.links || []).find((l: { rel: string; href: string }) => l.rel === "approve");
  if (!approve) throw new Error("No approval link in PayPal response");
  return { id: json.id, approveUrl: approve.href };
}

/** Verify a PayPal webhook signature server-side via the verify-webhook-signature
 * endpoint (PayPal has no local HMAC scheme). Needs PAYPAL_WEBHOOK_ID. Returns true
 * when PayPal confirms the event is authentic. */
export async function verifyWebhook(headers: Record<string, string | null>, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID not set");
  const token = await accessToken();
  const res = await fetch(`${base()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    }),
  });
  const json = await res.json();
  return json?.verification_status === "SUCCESS";
}
