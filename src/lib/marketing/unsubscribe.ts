// Unsubscribe tokens — same HMAC idiom as reviews/token.ts. Every marketing
// email footer carries /u/<token>; opening it flips guests.marketing_opt_out
// and the guest is excluded from every future campaign (compliance:
// settings.compliance + GDPR require a working opt-out on promo email).

import crypto from "crypto";

export interface UnsubscribePayload {
  /** guest id */
  g: string;
  /** tenant id (so the page can name the restaurant) */
  t: string;
}

function secret(): string {
  const k = process.env.REVIEW_LINK_SECRET || process.env.CRON_SECRET;
  if (!k) throw new Error("REVIEW_LINK_SECRET/CRON_SECRET not set");
  return k;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", `unsub:${secret()}`).update(data, "utf8").digest("base64url").slice(0, 22);
}

export function createUnsubscribeToken(payload: UnsubscribePayload): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(data);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (typeof payload?.g !== "string" || typeof payload?.t !== "string") return null;
    return payload as UnsubscribePayload;
  } catch {
    return null;
  }
}
