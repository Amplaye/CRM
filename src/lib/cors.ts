import { NextRequest, NextResponse } from 'next/server';

/**
 * Cross-origin policy for AI / webhook routes.
 *
 * These routes are called server-to-server (n8n, Retell, Twilio). They
 * have no legitimate browser caller today, so the policy is "no browser
 * cross-origin access". `assertAiSecret` already requires a custom header
 * a browser can't add without a CORS preflight, but this guard is an
 * extra layer of defense and a clear allow-list for the future.
 *
 * Allow-list is the dashboard origin itself, so same-origin fetches from
 * /admin or /conversations keep working if anyone ever wires them up.
 */
const ALLOWED_ORIGINS = new Set([
  'https://crm.baliflowagency.com',
  'http://localhost:3000',
]);

const SENSITIVE_PREFIXES = ['/api/ai/', '/api/webhooks', '/api/twilio/'];

export function enforceApiCors(request: NextRequest): NextResponse | null {
  const path = request.nextUrl.pathname;
  if (!SENSITIVE_PREFIXES.some((p) => path.startsWith(p))) return null;

  const origin = request.headers.get('origin');
  if (!origin) return null; // server-to-server, no Origin header → pass

  if (!ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json(
      { error: 'Cross-origin not allowed for this endpoint' },
      { status: 403 }
    );
  }

  // Same-origin browser fetch: short-circuit preflight cleanly.
  if (request.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 });
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'content-type, authorization, x-ai-secret');
    res.headers.set('Access-Control-Max-Age', '300');
    return res;
  }

  return null;
}
