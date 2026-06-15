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

async function stripePost(
  path: string,
  body: Record<string, unknown>,
  // An Idempotency-Key makes a create call safe to retry: Stripe returns the SAME
  // object instead of creating a duplicate (24h window). Essential in the webhook,
  // which Stripe may deliver more than once.
  opts: { idempotencyKey?: string } = {},
): Promise<StripeJson> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key()}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers,
    body: encodeForm(body),
  });
  const json = (await res.json()) as StripeJson;
  if (!res.ok) {
    throw new Error(json?.error?.message || `Stripe ${res.status}`);
  }
  return json;
}

async function stripeGet(path: string, query?: Record<string, string | string[]>): Promise<StripeJson> {
  const qs = query ? `?${encodeForm(query)}` : "";
  const res = await fetch(`${API}${path}${qs}`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  const json = (await res.json()) as StripeJson;
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

async function stripeDelete(path: string): Promise<StripeJson> {
  const res = await fetch(`${API}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key()}` },
  });
  const json = (await res.json()) as StripeJson;
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
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
export function verifyWebhook(
  payload: string,
  sigHeader: string | null,
  // Each Stripe endpoint has its OWN signing secret. Defaults to the main billing
  // secret; the pilot endpoint passes STRIPE_PILOT_WEBHOOK_SECRET.
  secretOverride?: string,
  toleranceSec = 300,
): Record<string, unknown> {
  const secret = secretOverride || process.env.STRIPE_WEBHOOK_SECRET;
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

// ---------------------------------------------------------------------------
// Paid-pilot → subscription primitives (see src/lib/billing/pilot.ts).
// ---------------------------------------------------------------------------

export interface PilotCheckoutParams {
  pilotPriceId: string;          // €150 one-time price (STRIPE_PILOT_PRICE_ID)
  successUrl: string;
  cancelUrl: string;
  consentMessage: string;        // shown above the pay button (req 10)
  metadata: Record<string, string>;
  taxEnabled: boolean;           // Stripe Tax only if configured (STRIPE_TAX_ENABLED)
  requireTos: boolean;           // add a ToS acceptance checkbox (needs ToS url in Stripe branding)
  businessNameLabel: string;     // i18n-able label for the custom "business name" field
  customerEmail?: string;        // prefill, optional
}

/** Step 1 of the pilot: a `mode:payment` Checkout that charges €150 TODAY, saves
 * the card for future off-session subscription charges, creates the customer and
 * collects name / business / billing address / VAT. The subscription itself is
 * created later, by the webhook (Stripe can't charge today AND start a trial in
 * one session). Returns the hosted-page url + session id. */
export async function createPilotCheckoutSession(params: PilotCheckoutParams): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    mode: "payment",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: [{ price: params.pilotPriceId, quantity: 1 }],
    // Always create+persist a Customer so the webhook can attach the subscription.
    customer_creation: "always",
    // Save the card off-session for the recurring subscription charges.
    payment_intent_data: {
      setup_future_usage: "off_session",
      description: "BALI Flow — 14-day Pilot",
      metadata: params.metadata,
    },
    // Collect billing details (stored on the auto-created customer).
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    custom_fields: [
      {
        key: "business_name",
        label: { type: "custom", custom: params.businessNameLabel },
        type: "text",
        optional: true,
      },
    ],
    // Consent / legal clarity text under the pay button.
    custom_text: { submit: { message: params.consentMessage } },
    customer_email: params.customerEmail,
    metadata: params.metadata,
  };
  if (params.taxEnabled) body.automatic_tax = { enabled: true };
  // ToS checkbox only when a ToS url is configured in Stripe (else the API rejects).
  if (params.requireTos) body.consent_collection = { terms_of_service: "required" };

  const session = await stripePost("/checkout/sessions", body);
  return { id: String(session.id), url: String(session.url) };
}

/** Retrieve a Checkout Session (used by the webhook to read collected details). */
export async function retrieveCheckoutSession(id: string): Promise<StripeJson> {
  return stripeGet(`/checkout/sessions/${id}`, { "expand[]": ["customer", "payment_intent"] });
}

export async function retrievePaymentIntent(id: string): Promise<StripeJson> {
  return stripeGet(`/payment_intents/${id}`);
}

/** Set the customer's default payment method (so subscription invoices charge it)
 * and merge metadata. */
export async function updateCustomer(
  customerId: string,
  params: { defaultPaymentMethod?: string; metadata?: Record<string, string> },
): Promise<StripeJson> {
  const body: Record<string, unknown> = {};
  if (params.defaultPaymentMethod) {
    body.invoice_settings = { default_payment_method: params.defaultPaymentMethod };
  }
  if (params.metadata) body.metadata = params.metadata;
  return stripePost(`/customers/${customerId}`, body);
}

export interface CreatePilotSubscriptionParams {
  customerId: string;
  monthlyPriceId: string;         // full recurring price (€299 / €399)
  trialPeriodDays: number;        // 14
  defaultPaymentMethod?: string;
  couponId?: string;              // optional override; when set, used instead of balance credit
  taxEnabled: boolean;
  metadata: Record<string, string>;
  idempotencyKey: string;         // = `pilot_sub_${sessionId}` — blocks duplicate subs on webhook retry
}

/** Step 2: the trialing subscription on the saved card. Full monthly price; the
 * €150 reduction on the first invoice is applied separately (coupon OR balance
 * credit) by the caller. */
export async function createPilotSubscription(params: CreatePilotSubscriptionParams): Promise<StripeJson> {
  const body: Record<string, unknown> = {
    customer: params.customerId,
    items: [{ price: params.monthlyPriceId }],
    trial_period_days: params.trialPeriodDays,
    collection_method: "charge_automatically",
    payment_settings: { save_default_payment_method: "on_subscription" },
    // If the card action fails at trial end, pause rather than instantly cancel.
    trial_settings: { end_behavior: { missing_payment_method: "pause" } },
    metadata: params.metadata,
  };
  if (params.defaultPaymentMethod) body.default_payment_method = params.defaultPaymentMethod;
  if (params.couponId) body.discounts = [{ coupon: params.couponId }];
  if (params.taxEnabled) body.automatic_tax = { enabled: true };
  return stripePost("/subscriptions", body, { idempotencyKey: params.idempotencyKey });
}

/** Add a credit to the customer balance (pass a NEGATIVE amount in cents). A
 * negative balance is auto-applied to the next invoice with a positive amount due
 * — i.e. the first real subscription invoice at trial end — and never to today's
 * one-time PaymentIntent. */
export async function addCustomerCredit(
  customerId: string,
  amountCents: number,
  currency: string,
  description: string,
  metadata: Record<string, string>,
  idempotencyKey?: string,
): Promise<StripeJson> {
  return stripePost(
    `/customers/${customerId}/balance_transactions`,
    { amount: amountCents, currency: currency.toLowerCase(), description, metadata },
    { idempotencyKey },
  );
}

/** Cancel a subscription IMMEDIATELY (no further invoices). Used to stop a pilot
 * before day 14 so the customer is never charged the first subscription invoice. */
export async function cancelSubscription(subscriptionId: string): Promise<StripeJson> {
  return stripeDelete(`/subscriptions/${subscriptionId}`);
}
