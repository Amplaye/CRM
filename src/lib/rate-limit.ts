import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

// Sliding-window rate limit backed by public.rate_limit_buckets +
// consume_rate_limit RPC. Opt-in via RATE_LIMIT_ENABLED=1 — when off the
// helper is a no-op so we never add a DB round-trip on the hot path.
//
// Usage:
//   const rl = await assertRateLimit(request, 'ai:availability', { max: 60, windowSecs: 60 });
//   if (rl) return rl;

export type RateLimitOptions = {
  max: number;       // max requests allowed in the window
  windowSecs: number;
};

function getClientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0].trim();
  if (first) return first;
  return request.headers.get('x-real-ip') || 'unknown';
}

export function rateLimitEnabled(): boolean {
  return process.env.RATE_LIMIT_ENABLED === '1';
}

export async function assertRateLimit(
  request: Request,
  scope: string,
  opts: RateLimitOptions
): Promise<NextResponse | null> {
  if (!rateLimitEnabled()) return null;

  const ip = getClientIp(request);
  const key = `${scope}:${ip}`;

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc('consume_rate_limit', {
      p_key: key,
      p_window_secs: opts.windowSecs,
      p_max: opts.max,
    });
    if (error) {
      // Fail-open: a transient DB error must not block the bot. Log and pass.
      console.error('[rate-limit] RPC error, failing open:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.allowed === false) {
      const resetAt = row.reset_at ? new Date(row.reset_at).toISOString() : '';
      return NextResponse.json(
        { error: 'rate_limit_exceeded', scope, reset_at: resetAt },
        {
          status: 429,
          headers: {
            'Retry-After': String(opts.windowSecs),
            'X-RateLimit-Limit': String(opts.max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': resetAt,
          },
        }
      );
    }
  } catch (e: any) {
    console.error('[rate-limit] exception, failing open:', e?.message);
  }
  return null;
}
