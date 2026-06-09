// Minimal Stripe REST client — no SDK dependency. Stripe's API is plain HTTPS +
// form-encoded bodies, so a small fetch wrapper covers everything we need
// (Checkout Sessions + webhook signature verification) and adds zero packages to
// the build. The moment STRIPE_SECRET_KEY lands in env, this works; until then
// `stripeConfigured()` is false and the checkout route returns a clean 503.

import crypto from "crypto";

const API = "https://api.stripe.com/v1";

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function key(): string {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) throw new Error("STRIPE_SECRET_KEY not set");
  return k;
}

/** Flatten a nested object into Stripe's bracketed form-encoding, e.g.
 * { line_items: [{ price: "x", quantity: 1 }] } →
 * line_items[0][price]=x&line_items[0][quantity]=1 */
function encodeForm(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const path = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") {
          parts.push(encodeForm(item as Record<string, unknown>, `${path}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${path}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (v && typeof v === "object") {
      parts.push(encodeForm(v as Record<string, unknown>, path));
    } else {
      parts.push(`${encodeURIComponent(path)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

// Stripe responses are loosely-typed JSON; a permissive record is the honest shape.
type StripeJson = Record<string, unknown> & { error?: { message?: string } };

async function stripePost(path: string, body: Record<string, unknown>): Promise<StripeJson> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(body),
  });
  const json = (await res.json()) as StripeJson;
  if (!res.ok) {
    throw new Error(json?.error?.message || `Stripe ${res.status}`);
  }
  return json;
}

export interface CheckoutLineItem {
  price: string;
  quantity: number;
}

/** Create a Checkout Session. `mode` is "subscription" for recurring plans/add-ons
 * and "payment" for the one-off website design. Returns the hosted-page url. */
export async function createCheckoutSession(params: {
  mode: "subscription" | "payment";
  lineItems: CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  clientReferenceId?: string; // tenant_id — read back in the webhook
  metadata?: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    mode: params.mode,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: params.lineItems,
    client_reference_id: params.clientReferenceId,
    customer_email: params.customerEmail,
    metadata: params.metadata,
  };
  const session = await stripePost("/checkout/sessions", body);
  return { id: String(session.id), url: String(session.url) };
}

/** Verify a Stripe webhook signature (the `Stripe-Signature` header). Implements
 * the same HMAC-SHA256 scheme as stripe.webhooks.constructEvent, so we don't need
 * the SDK. Returns the parsed event on success, throws on a bad/expired signature. */
export function verifyWebhook(payload: string, sigHeader: string | null, toleranceSec = 300): Record<string, unknown> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
  if (!sigHeader) throw new Error("Missing Stripe-Signature header");

  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    }),
  );
  const timestamp = parts["t"];
  const v1 = parts["v1"];
  if (!timestamp || !v1) throw new Error("Malformed Stripe-Signature");

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  // Constant-time compare.
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Signature verification failed");
  }
  // Replay protection.
  const age = Math.floor(Number(timestamp));
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - age) > toleranceSec) throw new Error("Timestamp outside tolerance");

  return JSON.parse(payload);
}
