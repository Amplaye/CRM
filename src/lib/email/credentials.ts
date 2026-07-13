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

/** The tenant's own Resend key, or null when it's on the shared platform pool
 * (the default). Fails soft: a decrypt error or a missing encryption key must
 * degrade to "use the shared pool" — an unreadable secret must never stop a
 * restaurant's booking confirmation from going out. Takes a service-role client
 * (RLS forbids members from reading email_secrets at all).
 *
 * The empty-string guard matters: `apiKey: ""` downstream would be a truthy-less
 * value that silently falls back anyway, but returning null makes it explicit. */
export async function resolveEmailApiKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  tenantId: string,
): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const { data } = await svc
      .from("email_secrets")
      .select("secret_enc")
      .eq("tenant_id", tenantId)
      .eq("provider", "resend")
      .maybeSingle();
    if (!data?.secret_enc) return null;
    const key = decryptEmailSecret(data.secret_enc).api_key;
    return typeof key === "string" && key ? key : null;
  } catch {
    return null;
  }
}
