import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';

// Create an async menu-extraction job. Replaces the slow, synchronous
// /api/menu/import-file: instead of blocking on the OpenAI call (which on a
// large PDF exceeds Vercel Hobby's 60s cap and the browser fetch dies with
// "Failed to fetch"), we insert a 'pending' row and hand the heavy work to the
// Supabase Edge Function `menu-extract` (150s window), then return a jobId
// immediately. The client polls GET /api/menu/import-job/[id].
//
// Auth: signed-in dashboard user only. RLS-checked tenant membership before we
// store anything.

export const runtime = 'nodejs';
// Only needs to read the multipart upload (up to ~8MB) and insert a row, then
// fire-and-forget the worker. Returns in ~1-2s; 60 is just headroom.
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED: Record<string, 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });

  const tenantId = form.get('tenant_id');
  const file = form.get('file');
  if (typeof tenantId !== 'string' || !tenantId) {
    return NextResponse.json({ error: 'Missing tenant_id' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });
  }

  const mediaType = ALLOWED[file.type.toLowerCase()];
  if (!mediaType) {
    return NextResponse.json(
      { error: `Unsupported file type "${file.type}". Use PDF, JPEG, PNG, WEBP or GIF.` },
      { status: 415 }
    );
  }

  // RLS sanity-check: confirm the user can access the tenant before we store a
  // multi-MB blob. The select hits tenants with RLS enabled — it returns a row
  // only if the user is a member (or platform_admin).
  const { data: tenantRow, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantErr || !tenantRow) {
    return NextResponse.json({ error: 'Tenant not accessible' }, { status: 403 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64Data = Buffer.from(bytes).toString('base64');

  // Insert the pending job via the service role (table writes are service-role
  // only by design — see the migration).
  const admin = createServiceRoleClient();
  const { data: job, error: insErr } = await admin
    .from('menu_import_jobs')
    .insert({
      tenant_id: tenantId,
      status: 'pending',
      source: 'file',
      file_base64: base64Data,
      media_type: mediaType,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (insErr || !job) {
    console.error('[menu import-job] insert failed', insErr);
    return NextResponse.json({ error: 'Could not create import job' }, { status: 500 });
  }

  // Fire-and-forget the worker. We do NOT await its body: the Edge Function
  // writes its own status to the row, so its lifetime is independent of this
  // request (which may be killed at 60s). keepalive lets the dispatch survive
  // the function returning. If the kick fails to even dispatch, the job stays
  // 'pending' and the client poll will eventually time out with a clear error.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const workerSecret = process.env.WORKER_SHARED_SECRET || '';
  try {
    void fetch(`${supaUrl}/functions/v1/menu-extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        ...(workerSecret ? { 'x-worker-secret': workerSecret } : {}),
      },
      body: JSON.stringify({ jobId: job.id }),
      keepalive: true,
    }).catch((e) => console.error('[menu import-job] worker kick failed', e));
  } catch (e) {
    console.error('[menu import-job] worker kick threw', e);
  }

  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
