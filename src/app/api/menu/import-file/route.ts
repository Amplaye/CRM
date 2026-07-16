import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { extractMenuFromFile } from '@/lib/menu/extract';
import { apiError } from "@/lib/api-error";

// Accept a PDF or image upload and return a parsed menu preview. The actual
// save-to-database step is a separate POST /api/menu/import-confirm so the
// user can review and edit the preview client-side first.
//
// Auth: signed-in dashboard user only. The client passes tenant_id; RLS will
// reject downstream writes if the user is not a member.

export const runtime = 'nodejs';
// Larger payloads need more time + memory than the default. PDFs up to ~8MB
// are realistic for restaurant menus.
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

  // RLS sanity-check: confirm the user can access the tenant before we burn
  // an LLM call. The select hits menu_categories with RLS enabled — it
  // returns rows only if the user is a member (or platform_admin).
  const { error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantErr) {
    return NextResponse.json({ error: 'Tenant not accessible' }, { status: 403 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64Data = Buffer.from(bytes).toString('base64');

  try {
    const extracted = await extractMenuFromFile({ base64Data, mediaType });
    return NextResponse.json({ ok: true, extracted });
  } catch (e: any) {
    console.error('[menu import-file]', e);
    return apiError(e, { route: 'menu/import-file', publicMessage: 'Extraction failed', status: 502, extra: { stage: 'llm' } });
  }
}
