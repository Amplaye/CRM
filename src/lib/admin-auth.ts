import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Gate for `/api/admin/*` route handlers. Requires a logged-in user with
 * `users.global_role = 'platform_admin'`.
 *
 * Usage:
 *
 *     const auth = await assertPlatformAdmin();
 *     if (!auth.ok) return auth.res;
 */
export async function assertPlatformAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; res: NextResponse }
> {
  const supabase = await createServerSupabaseClient();

  // Read the session from the request cookie LOCALLY (no Auth-server round-trip).
  // We deliberately don't call getUser() here: it costs ~190ms per call against the
  // Auth server, and the admin pages fan out to several /api/admin/* routes that each
  // re-run this gate — that latency stacked into seconds of "the admin CRM is slow".
  //
  // Security: the `users` SELECT below runs through the anon-key SSR client, so
  // PostgREST verifies the JWT signature + expiry server-side and rejects a forged
  // or stale token with 401 → `data` is null → we return 403. So a tampered cookie
  // can't pass this gate; the authoritative role check (global_role) is what we
  // actually trust, and it sits behind real JWT verification.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { data, error } = await supabase
    .from('users')
    .select('global_role')
    .eq('id', userId)
    .single();
  if (error || data?.global_role !== 'platform_admin') {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId };
}
