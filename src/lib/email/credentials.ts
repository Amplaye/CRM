// Email credential encryption — same AES-256-GCM scheme as POS/payment secrets.
// A tenant's own Resend API key is a live sending credential: it goes encrypted
// in email_secrets (service-role only), NEVER in tenants.settings (the browser
// reads settings, so a key there is a leak).
//
// Reads EMAIL_CRED_ENC_KEY, falling back to POS_CRED_ENC_KEY — that fallback is
// what lets this ship without adding a new Vercel env var first (exactly what
// src/lib/billing/secrets.ts already does).

import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey(): Buffer {
  const raw = process.env.EMAIL_CRED_ENC_KEY || process.env.POS_CRED_ENC_KEY;
  if (!raw) throw new Error("EMAIL_CRED_ENC_KEY/POS_CRED_ENC_KEY not set — cannot (de)crypt email secrets");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function encryptEmailSecret(plain: Record<string, unknown>): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(plain), "utf8");
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptEmailSecret(secretEnc: string): Record<string, unknown> {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = secretEnc.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed email secret blob");
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

/** A tenant's email setup: its own Resend key AND the address it sends from.
 *
 * The two are inseparable, which is why they travel together. Resend only
 * relays a From on a domain verified inside the SAME account the key belongs
 * to — anything else comes back `403 "The <domain> domain is not verified"`
 * (reproduced against the live API). So a key with no sender address of its own
 * isn't a half-configured tenant, it's one whose every send would bounce. */
export interface TenantEmailConfig {
  apiKey: string;
  /** Bare address on a domain THIS tenant verified in ITS Resend account. */
  fromAddress: string;
}

/** Raw read of the stored secret. `fromAddress` may be "" — that's a tenant that
 * pasted a key but hasn't picked a sender yet, which only the Settings route
 * cares about (it needs the key to re-validate a new address against Resend).
 * Everything that SENDS must go through resolveTenantEmail() instead. */
export async function readEmailSecret(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  tenantId: string,
): Promise<{ apiKey: string; fromAddress: string } | null> {
  if (!tenantId) return null;
  try {
    const { data } = await svc
      .from("email_secrets")
      .select("secret_enc")
      .eq("tenant_id", tenantId)
      .eq("provider", "resend")
      .maybeSingle();
    if (!data?.secret_enc) return null;
    const blob = decryptEmailSecret(data.secret_enc);
    const apiKey = typeof blob.api_key === "string" ? blob.api_key.trim() : "";
    if (!apiKey) return null;
    const fromAddress = typeof blob.from_address === "string" ? blob.from_address.trim() : "";
    return { apiKey, fromAddress };
  } catch {
    return null;
  }
}

/** The tenant's email setup, or null when it cannot legally send.
 *
 * Null means one thing, everywhere: THIS TENANT SENDS NO EMAIL. There is no
 * shared platform account to fall back on (owner decision) — no campaigns, no
 * gift cards, no coupons, nothing. Callers must skip the send and say why, never
 * substitute another key.
 *
 * Fails soft to null on a decrypt/env error, and that direction is deliberate:
 * an unreadable secret degrades to "no email", never to "send it on somebody
 * else's account". Takes a service-role client (RLS forbids members from reading
 * email_secrets at all). */
export async function resolveTenantEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  tenantId: string,
): Promise<TenantEmailConfig | null> {
  const secret = await readEmailSecret(svc, tenantId);
  if (!secret?.fromAddress) return null;
  return { apiKey: secret.apiKey, fromAddress: secret.fromAddress };
}
