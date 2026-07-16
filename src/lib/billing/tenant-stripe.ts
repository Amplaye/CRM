// The tenant's OWN Stripe key — the BYO pattern of resolveTenantEmail applied to
// money. Pay-at-table charges the guest on the RESTAURANT'S Stripe account, never
// the platform's: the key lives encrypted in payment_secrets (provider 'stripe',
// service-role/admin only) and null means one thing everywhere — THIS TENANT
// TAKES NO QR PAYMENTS. Callers must degrade to "pay at the till", never
// substitute the platform key (that would collect a venue's takings on the
// agency's account).
//
// The Stripe calls here are deliberately NOT in src/lib/billing/stripe.ts: that
// module is hard-wired to the platform's STRIPE_SECRET_KEY, and keeping the
// tenant-key surface separate makes it impossible to charge a guest on the wrong
// account by forgetting a parameter.

import { encryptPaymentSecret, decryptPaymentSecret } from "@/lib/billing/secrets";

const API = "https://api.stripe.com/v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any; // service-role Supabase client (RLS forbids members from reading payment_secrets)

/** A secret key (sk_) or restricted key (rk_) — live or test. */
export function looksLikeStripeSecretKey(raw: string): boolean {
  return /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(raw.trim());
}

/** The tenant's own Stripe secret key, or null when it cannot charge. Fails soft
 * to null on a decrypt/env error — an unreadable secret degrades to "no QR
 * payments", never to "charge on somebody else's account". */
export async function resolveTenantStripeKey(svc: Svc, tenantId: string): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const { data } = await svc
      .from("payment_secrets")
      .select("secret_enc")
      .eq("tenant_id", tenantId)
      .eq("provider", "stripe")
      .maybeSingle();
    if (!data?.secret_enc) return null;
    const blob = decryptPaymentSecret(data.secret_enc);
    const key = typeof blob.secret_key === "string" ? blob.secret_key.trim() : "";
    return looksLikeStripeSecretKey(key) ? key : null;
  } catch {
    return null;
  }
}

/** Persist the tenant's key (upsert on tenant+provider). Returns an error message
 * or null. Validation against Stripe happens in the route, before this. */
export async function saveTenantStripeKey(svc: Svc, tenantId: string, secretKey: string): Promise<string | null> {
  const { error } = await svc.from("payment_secrets").upsert(
    {
      tenant_id: tenantId,
      provider: "stripe",
      secret_enc: encryptPaymentSecret({ secret_key: secretKey }),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,provider" },
  );
  return error ? error.message : null;
}

export async function deleteTenantStripeKey(svc: Svc, tenantId: string): Promise<string | null> {
  const { error } = await svc
    .from("payment_secrets")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("provider", "stripe");
  return error ? error.message : null;
}

// ---------------------------------------------------------------------------
// Tenant-key Stripe REST calls (same no-SDK approach as stripe.ts).
// ---------------------------------------------------------------------------

type StripeJson = Record<string, unknown> & { error?: { message?: string } };

/** Flatten a nested object into Stripe's bracketed form-encoding (same rules as
 * stripe.ts, duplicated on purpose: no import ties to the platform module). */
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

async function tenantStripePost(key: string, path: string, body: Record<string, unknown>): Promise<StripeJson> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: encodeForm(body),
  });
  const json = (await res.json()) as StripeJson;
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

async function tenantStripeGet(key: string, path: string): Promise<StripeJson> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const json = (await res.json()) as StripeJson;
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${res.status}`);
  return json;
}

/** Cheapest authenticated call: GET /account answers "is this key real, whose is
 * it, and can it charge?" in one round-trip. `charges_enabled: false` is worth
 * surfacing — a brand-new Stripe account can create sessions that then refuse
 * every card, which the owner would otherwise discover from a guest. */
export async function checkTenantStripeKey(
  key: string,
): Promise<{ ok: boolean; livemode?: boolean; chargesEnabled?: boolean; accountName?: string; error?: string }> {
  try {
    const acc = await tenantStripeGet(key, "/account");
    const settings = acc.settings as Record<string, unknown> | undefined;
    const dashboard = settings?.dashboard as Record<string, unknown> | undefined;
    return {
      ok: true,
      livemode: key.includes("_live_"),
      chargesEnabled: acc.charges_enabled === true,
      accountName:
        (typeof dashboard?.display_name === "string" && dashboard.display_name) ||
        (typeof acc.business_profile === "object" &&
          acc.business_profile &&
          typeof (acc.business_profile as Record<string, unknown>).name === "string" &&
          ((acc.business_profile as Record<string, unknown>).name as string)) ||
        "",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Checkout for the table bill: mode payment, immediate capture, ad-hoc amount
 * (price_data — the bill total in cents, frozen at creation; the confirm step
 * re-compares it with the live total before settling). */
export async function createTableBillCheckoutSession(
  key: string,
  params: {
    amountCents: number;
    currency: string;
    productName: string; // e.g. "Conto — Trattoria X · Tavolo 4"
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>; // { kind:"table_pay", tenant_id, order_id, table_id }
    locale?: string;
  },
): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    mode: "payment",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: params.currency.toLowerCase(),
          unit_amount: params.amountCents,
          product_data: { name: params.productName },
        },
      },
    ],
    payment_intent_data: { description: params.productName, metadata: params.metadata },
    metadata: params.metadata,
  };
  if (params.locale) body.locale = params.locale;
  const session = await tenantStripePost(key, "/checkout/sessions", body);
  return { id: String(session.id), url: String(session.url) };
}

/** Retrieve a Checkout Session with the tenant key — the pull-based verification
 * that replaces per-tenant webhooks (a BYO account has no endpoint configured;
 * the guest's phone calls confirm on return from Stripe and we ask Stripe
 * directly whether the session is paid). */
export async function retrieveTenantCheckoutSession(
  key: string,
  sessionId: string,
): Promise<{ paid: boolean; amountTotal: number | null; currency: string | null; metadata: Record<string, string> }> {
  const s = await tenantStripeGet(key, `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  return {
    paid: s.payment_status === "paid",
    amountTotal: typeof s.amount_total === "number" ? s.amount_total : null,
    currency: typeof s.currency === "string" ? s.currency : null,
    metadata: (s.metadata && typeof s.metadata === "object" ? s.metadata : {}) as Record<string, string>,
  };
}
