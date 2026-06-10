import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { ACCEPTED_EXTENSIONS } from '@/lib/menu/limits';

// Issue a one-time signed upload URL so the browser can PUT a large menu file
// STRAIGHT into private Storage, bypassing Vercel's 4.5 MB serverless request
// body cap. A big menu (the bug report was a 9.4 MB PDF) posted as multipart to
// /api/menu/import-job is rejected at the platform edge before our code runs;
// iOS Safari surfaces that rejected upload as the opaque
// `SyntaxError: The string did not match the expected pattern.`
//
// The signed URL is minted with the service role, so the upload needs no
// Storage RLS policy on the private `menu-imports` bucket (the token authorises
// exactly one PUT to one path). The client then hands /api/menu/import-job only
// the resulting storage path; the route reads the bytes back server-side.
//
// Auth: signed-in dashboard user, RLS-checked tenant membership.

export const runtime = 'nodejs';

const IMPORTS_BUCKET = 'menu-imports';

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { tenant_id?: string; file_name?: string }
    | null;
  if (!body || typeof body.tenant_id !== 'string' || !body.tenant_id) {
    return NextResponse.json({ error: 'Missing tenant_id' }, { status: 400 });
  }

  // RLS sanity-check: only mint a URL for a tenant the user can actually access.
  const { data: tenantRow, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', body.tenant_id)
    .maybeSingle();
  if (tenantErr || !tenantRow) {
    return NextResponse.json({ error: 'Tenant not accessible' }, { status: 403 });
  }

  // Keep the original extension (whitelisted) so the import-job route can fall
  // back to it when the read-back blob carries no content-type. Path lives under
  // the tenant id so import-job can confirm the upload stayed in-tenant.
  const rawExt = (body.file_name?.split('.').pop() || '').toLowerCase();
  const ext = ACCEPTED_EXTENSIONS.some((e) => e === `.${rawExt}`) ? rawExt : 'bin';
  const path = `${body.tenant_id}/${crypto.randomUUID()}.${ext}`;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.storage
    .from(IMPORTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error('[menu upload-url] sign failed', error);
    return NextResponse.json({ error: 'Could not create upload URL' }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}
