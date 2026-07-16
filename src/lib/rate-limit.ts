import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logSystemEvent } from '@/lib/system-log';

// Sliding-window rate limit backed by public.rate_limit_buckets +
// consume_rate_limit RPC. ON by default — opt-out only with
// RATE_LIMIT_ENABLED=0 (emergency lever if the RPC misbehaves).
// On DB errors the limiter fails OPEN (bot availability beats strictness)
// but raises a high-severity system log so the failure is visible.
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
  return process.env.RATE_LIMIT_ENABLED !== '0';
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
      await logSystemEvent({
        category: 'system',
        severity: 'high',
        title: 'Rate limit RPC error (failing open)',
        description: error.message,
        error_key: 'rate-limit-rpc-error',
      });
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
    await logSystemEvent({
      category: 'system',
      severity: 'high',
      title: 'Rate limit exception (failing open)',
      description: e?.message,
      error_key: 'rate-limit-rpc-error',
    });
  }
  return null;
}
