import crypto from 'node:crypto';

// Reference: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
//
// Meta signs every webhook POST with HMAC-SHA256(appSecret, rawBody), sent in
// the `X-Hub-Signature-256` header as "sha256=<hex>". Verifying it protects us
// from spoofed webhooks (anyone who knows the path could otherwise POST fake
// messages into our pipeline). It replaced the old Twilio SHA-1 scheme, whose
// helper was deleted with the rest of Twilio on 2026-07-20.
//
// FAIL-CLOSED: verification is active whenever META_APP_SECRET is configured.
// The only way to skip it is the explicit emergency opt-out
// FACEBOOK_VERIFY_SIGNATURE=0 (rollback lever: set it + redeploy, no revert).
// With no app secret configured at all there is nothing to verify against, so
// requests pass — set META_APP_SECRET in every environment that receives real
// Meta traffic.

export function isMetaVerificationEnabled(): boolean {
  if (process.env.FACEBOOK_VERIFY_SIGNATURE === '0') return false;
  return Boolean(process.env.META_APP_SECRET);
}

/**
 * Verify a Meta webhook signature against the RAW request body.
 *
 * @param rawBody    The exact bytes of the request body (must be unparsed —
 *                   re-serialising JSON changes whitespace and breaks the hash).
 * @param signature  Value of the `X-Hub-Signature-256` header ("sha256=...").
 * @param appSecret  Meta app secret (defaults to process.env.META_APP_SECRET).
 *
 * @returns true if verification is disabled, or if the signature matches.
 *          false if enabled and signature is missing/invalid.
 */
export function verifyMetaSignature(
  rawBody: string,
  signature: string | null | undefined,
  appSecret: string | undefined = process.env.META_APP_SECRET
): boolean {
  if (!isMetaVerificationEnabled()) return true;
  if (!signature || !appSecret) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(Buffer.from(rawBody, 'utf-8')).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Convenience helper for Next.js Route Handlers receiving a Meta webhook.
 * Reads the raw body and checks the X-Hub-Signature-256 header.
 *
 * NOTE: this consumes the request body. Callers that also need to parse the
 * body should read the text once and pass it to verifyMetaSignature directly
 * (see /api/webhooks/incoming-message), rather than calling this twice.
 *
 * Usage:
 *   const ok = await verifyMetaRequest(request);
 *   if (!ok) return new Response('forbidden', { status: 403 });
 */
export async function verifyMetaRequest(request: Request): Promise<boolean> {
  if (!isMetaVerificationEnabled()) return true;
  const signature = request.headers.get('x-hub-signature-256');
  const rawBody = await request.text();
  return verifyMetaSignature(rawBody, signature);
}

/**
 * Handle Meta's webhook verification handshake (GET).
 * Meta calls GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * once when you register/verify a webhook. Echo back hub.challenge as plain
 * text when the token matches META_WEBHOOK_VERIFY_TOKEN.
 *
 * @returns a Response (200 with the challenge, or 403) — or null when this
 *          isn't a verification request (so the caller can handle it normally).
 */
export function handleMetaWebhookVerification(request: Request): Response | null {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode !== 'subscribe' || challenge === null) return null;

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (expected && token === expected) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
}
