import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// Status poll for an async menu-extraction job (created by POST
// /api/menu/import-job, processed by the Supabase Edge Function menu-extract).
// The dashboard polls this every couple seconds until status is done|error.
//
// Reads through the SIGNED-IN user's client so the "menu_import_jobs tenant
// read" RLS policy enforces tenant ownership — a user can only see their own
// tenant's jobs. We never return file_base64.

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: job, error } = await supabase
    .from('menu_import_jobs')
    .select('id, status, result, error, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!job) {
    // Either it doesn't exist or RLS hid another tenant's job — same answer.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    result: job.status === 'done' ? job.result : undefined,
    error: job.status === 'error' ? job.error : undefined,
  });
}
