import crypto from 'node:crypto';

// Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security
//
// Twilio signs every outbound webhook with HMAC-SHA1(authToken, url + sortedParams).
// Verification protects us from spoofed webhooks (anyone who knows the path could
// otherwise POST fake messages into our pipeline).
//
// FAIL-CLOSED: verification is active whenever TWILIO_AUTH_TOKEN is configured.
// The only way to skip it is the explicit emergency opt-out
// TWILIO_VERIFY_SIGNATURE=0 (rollback lever: set it + redeploy, no revert).
// With no auth token configured there is nothing to verify against, so
// requests pass — set TWILIO_AUTH_TOKEN in every environment that receives
// real Twilio traffic.

export function isTwilioVerificationEnabled(): boolean {
  if (process.env.TWILIO_VERIFY_SIGNATURE === '0') return false;
  return Boolean(process.env.TWILIO_AUTH_TOKEN);
}

/**
 * Verify a Twilio webhook signature.
 *
 * @param fullUrl  Absolute URL Twilio called (must match exactly what Twilio used).
 *                 Behind a proxy you typically rebuild from x-forwarded-proto/host.
 * @param params   Form-encoded body parsed as a plain object (e.g. URLSearchParams → entries).
 *                 For raw JSON webhooks (n8n-relayed), pass {} and signature still works
 *                 if Twilio used JSON mode (rare; usually form-encoded).
 * @param signature  Value of the `X-Twilio-Signature` request header.
 * @param authToken  Twilio Auth Token (defaults to process.env.TWILIO_AUTH_TOKEN).
 *
 * @returns true if verification is disabled, or if the signature matches.
 *          false if enabled and signature is missing/invalid.
 */
export function verifyTwilioSignature(
  fullUrl: string,
  params: Record<string, string>,
  signature: string | null | undefined,
  authToken: string | undefined = process.env.TWILIO_AUTH_TOKEN
): boolean {
  if (!isTwilioVerificationEnabled()) return true;
  if (!signature || !authToken) return false;

  const sortedKeys = Object.keys(params).sort();
  let data = fullUrl;
  for (const k of sortedKeys) data += k + params[k];

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

/**
 * Convenience helper for Next.js Route Handlers receiving a Twilio form-encoded
 * webhook. Reconstructs the URL from request headers (handles Vercel proxy) and
 * extracts form fields.
 *
 * Usage:
 *   const ok = await verifyTwilioRequest(request);
 *   if (!ok) return new Response('forbidden', { status: 403 });
 */
export async function verifyTwilioRequest(request: Request): Promise<boolean> {
  if (!isTwilioVerificationEnabled()) return true;

  const signature = request.headers.get('x-twilio-signature');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const url = new URL(request.url);
  const fullUrl = `${proto}://${host}${url.pathname}${url.search}`;

  // Twilio webhooks are application/x-www-form-urlencoded by default.
  const contentType = request.headers.get('content-type') || '';
  let params: Record<string, string> = {};
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = await request.text();
    for (const [k, v] of new URLSearchParams(body)) params[k] = v;
  }

  return verifyTwilioSignature(fullUrl, params, signature);
}
