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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { data } = await supabase
    .from('users')
    .select('global_role')
    .eq('id', user.id)
    .single();
  if (data?.global_role !== 'platform_admin') {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}
