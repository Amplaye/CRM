// POS credential encryption — secrets NEVER live in tenants.settings (the browser
// reads settings everywhere → an API key there is a leak). They go AES-256-GCM
// encrypted in the dedicated pos_credentials table, decrypted only server-side by
// the sync orchestrator (service-role). The MockAdapter has no secrets, so a tenant
// with no pos_credentials row simply yields `{}`.

import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard nonce length
const KEY_ENV = "POS_CRED_ENC_KEY";

/** Derive the 32-byte key from POS_CRED_ENC_KEY. Accepts a 64-char hex string or
 * any passphrase (hashed to 32 bytes via sha256). Throws if unset — encrypting
 * with no key would silently store recoverable plaintext-equivalent data. */
function getKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) throw new Error(`${KEY_ENV} not set — cannot (de)crypt POS credentials`);
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

/** Encrypt a plain credentials object → a compact "iv:tag:ciphertext" base64 string
 * suitable for pos_credentials.secret_enc. */
export function encryptCredentials(plain: Record<string, unknown>): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(plain), "utf8");
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/** Reverse of encryptCredentials. */
export function decryptSecret(secretEnc: string): Record<string, unknown> {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = secretEnc.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed POS credential blob");
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

/** Load + decrypt the credentials for a connection. Returns `{}` when there is no
 * row (the mock provider, or a not-yet-configured real till) so adapters can rely
 * on always getting an object. Takes a service-role client (RLS forbids members). */
export async function decryptCredentials(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  connectionId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("pos_credentials")
    .select("secret_enc")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (!data?.secret_enc) return {};
  return decryptSecret(data.secret_enc);
}
