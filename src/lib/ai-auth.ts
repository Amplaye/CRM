import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Guards AI-webhook routes (n8n / Retell / Twilio integrations) with a
 * shared secret header. Designed for safe rollout:
 *
 *   - If AI_WEBHOOK_SECRET env var is NOT set, logs a warning and allows
 *     the request through. This lets production keep working while the
 *     secret is being rolled out on Vercel.
 *   - If the env var IS set, requires a matching `x-ai-secret` header.
 *     Uses timing-safe comparison to prevent timing attacks.
 *
 * Usage:
 *
 *   export async function POST(request: Request) {
 *     const unauth = assertAiSecret(request);
 *     if (unauth) return unauth;
 *     // ... existing handler
 *   }
 */
export function assertAiSecret(request: Request): NextResponse | null {
  const expected = process.env.AI_WEBHOOK_SECRET;

  if (!expected) {
    console.warn('[SECURITY] AI_WEBHOOK_SECRET not set — /api/ai/* accepting all requests');
    return null;
  }

  const provided = request.headers.get('x-ai-secret') || '';

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');

  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
