import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Guards AI-webhook routes (n8n / Vapi / Twilio integrations) with a
 * shared secret header. Fail-closed:
 *
 *   - If AI_WEBHOOK_SECRET env var is NOT set, every request is rejected
 *     (503). The secret is set on Vercel for all environments; an unset
 *     secret means a misconfiguration, not an open door.
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
    console.error('[SECURITY] AI_WEBHOOK_SECRET not set — refusing all /api/ai/* requests');
    return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 });
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
