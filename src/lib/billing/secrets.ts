// Payment credential encryption — same AES-256-GCM scheme as POS credentials, in
// its own module so billing has an independent key if you want one. Reads
// PAYMENT_CRED_ENC_KEY, falling back to POS_CRED_ENC_KEY so a single key can serve
// both. Secrets (per-tenant provider material) go encrypted in payment_secrets,
// never in tenants.settings (the browser reads settings).

import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey(): Buffer {
  const raw = process.env.PAYMENT_CRED_ENC_KEY || process.env.POS_CRED_ENC_KEY;
  if (!raw) throw new Error("PAYMENT_CRED_ENC_KEY/POS_CRED_ENC_KEY not set — cannot (de)crypt payment secrets");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function encryptPaymentSecret(plain: Record<string, unknown>): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(plain), "utf8");
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptPaymentSecret(secretEnc: string): Record<string, unknown> {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = secretEnc.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed payment secret blob");
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}
