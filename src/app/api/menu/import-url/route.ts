import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { fetchUrlContent } from '@/lib/menu/fetch-url';
import { extractMenuFromFile, extractMenuFromText } from '@/lib/menu/extract';

// Accept a URL pointing to the restaurant's existing QR target (PDF, image,
// or HTML page) and return a parsed menu preview. Saving to DB is done by
// the same /api/menu/import-confirm route as for file uploads.

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { tenant_id?: string; url?: string } | null;
  if (!body || typeof body.tenant_id !== 'string' || typeof body.url !== 'string') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // RLS sanity check before we spend on the LLM.
  const { error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', body.tenant_id)
    .maybeSingle();
  if (tenantErr) {
    return NextResponse.json({ error: 'Tenant not accessible' }, { status: 403 });
  }

  const fetched = await fetchUrlContent(body.url);
  if (!fetched.ok) {
    const msgMap: Record<string, string> = {
      invalid_url: 'Invalid URL.',
      unreachable: 'Could not reach the URL.',
      too_large: 'File at this URL is too large (max 8 MB).',
      unsupported_type: 'Unsupported content type at this URL.',
      spa_no_content:
        'This URL is a dynamic web page (TheFork, Flipdish, etc.). Please download the menu as PDF and upload it instead.',
      empty: 'No menu content found at this URL.',
    };
    return NextResponse.json(
      { error: msgMap[fetched.reason] || fetched.reason, reason: fetched.reason, details: fetched.details },
      { status: 422 }
    );
  }

  try {
    if (fetched.kind === 'binary') {
      const extracted = await extractMenuFromFile({
        base64Data: fetched.base64,
        mediaType: fetched.mediaType,
      });
      return NextResponse.json({ ok: true, extracted, source: 'binary' });
    } else {
      const extracted = await extractMenuFromText(fetched.text);
      return NextResponse.json({ ok: true, extracted, source: 'text' });
    }
  } catch (e: any) {
    console.error('[menu import-url]', e);
    return NextResponse.json(
      { error: e?.message || 'Extraction failed', stage: 'llm' },
      { status: 502 }
    );
  }
}
