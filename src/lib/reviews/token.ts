// Signed review-link tokens. The post-visit follow-up sends the guest
// /rv/<token>; the token proves "this reservation really existed" without any
// login, making the collected reviews CERTIFIED (Zenchef model: only real
// diners can rate). One URL-safe path segment: base64url payload + "." +
// truncated HMAC.
//
// Secret: REVIEW_LINK_SECRET, falling back to CRON_SECRET (already in Vercel
// env) so the feature works without a new secret; set the dedicated one to
// rotate independently.

import crypto from "crypto";

export interface ReviewTokenPayload {
  /** tenant slug — resolves branding + review_url on the public page. */
  s: string;
  /** reservation id. */
  r: string;
}

function secret(): string {
  const k = process.env.REVIEW_LINK_SECRET || process.env.CRON_SECRET;
  if (!k) throw new Error("REVIEW_LINK_SECRET/CRON_SECRET not set");
  return k;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", secret()).update(data, "utf8").digest("base64url").slice(0, 22);
}

export function createReviewToken(payload: ReviewTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${data}.${sign(data)}`;
}

/** Returns the payload when the signature checks out, null otherwise. */
export function verifyReviewToken(token: string): ReviewTokenPayload | null {
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
    if (typeof payload?.s !== "string" || typeof payload?.r !== "string") return null;
    return payload as ReviewTokenPayload;
  } catch {
    return null;
  }
}
