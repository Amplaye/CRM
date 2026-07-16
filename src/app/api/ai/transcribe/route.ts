import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { assertRateLimit } from '@/lib/rate-limit';
import { assertCredits, consumeCredits } from '@/lib/billing/credits';

/**
 * Transcribe an inbound WhatsApp voice note so customers can book by audio.
 *
 * The n8n engine (motore unico) cannot upload binary multipart from its Code
 * node — n8n's httpRequest helper JSON-stringifies Buffers, UTF-8-mangles
 * string bodies and drops the `formData` option. So the engine offloads the
 * whole download+transcribe step here: it sends `{ tenant_id, audio_id }` (a
 * plain JSON body, which n8n transmits faithfully) and gets back `{ text }`.
 *
 * Secrets stay server-side: the Meta access token is read from
 * tenants.secrets; Whisper uses the server OPENAI_API_KEY. Authenticated with
 * the same x-ai-secret shared header as the other /api/ai/* routes.
 */

const GRAPH_VER = process.env.META_GRAPH_VERSION || 'v21.0';
const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // OpenAI Whisper hard limit is 25 MB.

type TenantRow = {
  settings: { bot_config?: Record<string, unknown> } | null;
  secrets: Record<string, unknown> | null;
};

export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  const rl = await assertRateLimit(request, 'ai:transcribe', { max: 120, windowSecs: 60 });
  if (rl) return rl;

  const body = (await request.json().catch(() => ({}))) as {
    tenant_id?: string;
    audio_id?: string;
    // Optional: caller may pass a pre-resolved media URL + token to skip the DB
    // lookup (not used by the engine, but handy for tests).
    media_url?: string;
    meta_token?: string;
    mime_type?: string;
  };

  const tenantId = (body.tenant_id || '').trim();
  const audioId = (body.audio_id || '').trim();
  if (!tenantId) return NextResponse.json({ error: 'Missing tenant_id' }, { status: 400 });
  if (!audioId && !body.media_url) {
    return NextResponse.json({ error: 'Missing audio_id' }, { status: 400 });
  }

  const openaiKey = process.env.OPENAI_API_KEY || '';
  if (!openaiKey) {
    console.error('[transcribe] OPENAI_API_KEY not set');
    return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 });
  }

  // Credit gate before we download the audio and call Whisper. The engine treats
  // a 403 here as "no transcription available" and asks the customer to type.
  const credits = await assertCredits(tenantId, 'transcription');
  if (credits) return credits;

  // 1) Resolve the Meta access token + language hint for this tenant.
  let metaToken = (body.meta_token || '').trim();
  let langHint = '';
  if (!metaToken || !body.media_url) {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('tenants')
      .select('settings, secrets')
      .eq('id', tenantId)
      .single();
    if (error || !data) {
      console.error('[transcribe] tenant lookup failed', tenantId, error?.message);
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenant = data as unknown as TenantRow;
    const secrets = tenant.secrets || {};
    if (!metaToken) metaToken = String(secrets.meta_access_token || '');
    const botCfg = (tenant.settings?.bot_config || {}) as Record<string, unknown>;
    const primaryLang = String(botCfg.primary_language || '').toLowerCase().slice(0, 2);
    if (['it', 'es', 'en', 'de', 'fr', 'pt'].includes(primaryLang)) langHint = primaryLang;
  }

  try {
    // 2) Resolve the media download URL (unless caller pre-resolved it).
    let mediaUrl = (body.media_url || '').trim();
    let mime = (body.mime_type || '').split(';')[0].trim();
    if (!mediaUrl) {
      if (!metaToken) {
        console.error('[transcribe] no meta_access_token for tenant', tenantId);
        return NextResponse.json({ error: 'Tenant missing Meta token' }, { status: 422 });
      }
      const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VER}/${audioId}`, {
        headers: { Authorization: `Bearer ${metaToken}` },
      });
      if (!metaRes.ok) {
        const t = await metaRes.text();
        console.error('[transcribe] media meta fetch failed', metaRes.status, t.slice(0, 200));
        return NextResponse.json({ error: 'Media metadata fetch failed' }, { status: 502 });
      }
      const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
      mediaUrl = meta.url || '';
      if (!mime) mime = String(meta.mime_type || '').split(';')[0].trim();
      if (!mediaUrl) return NextResponse.json({ error: 'No media url' }, { status: 502 });
    }

    // 3) Download the audio bytes (Graph CDN also requires the bearer token).
    const binRes = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${metaToken}` } });
    if (!binRes.ok) {
      const t = await binRes.text();
      console.error('[transcribe] media download failed', binRes.status, t.slice(0, 200));
      return NextResponse.json({ error: 'Media download failed' }, { status: 502 });
    }
    const arrayBuf = await binRes.arrayBuffer();
    const bytes = Buffer.from(arrayBuf);
    if (!bytes.length) return NextResponse.json({ error: 'Empty audio' }, { status: 422 });
    if (bytes.length > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'Audio too large' }, { status: 413 });
    }
    if (!mime) mime = 'audio/ogg';
    const ext =
      mime.includes('mpeg') || mime.includes('mp3')
        ? 'mp3'
        : mime.includes('mp4') || mime.includes('m4a')
          ? 'm4a'
          : mime.includes('wav')
            ? 'wav'
            : mime.includes('webm')
              ? 'webm'
              : 'ogg';

    // 4) Whisper transcription. Real Node runtime here → native FormData/Blob work.
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('response_format', 'text');
    if (langHint) form.append('language', langHint);

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!whisperRes.ok) {
      const t = await whisperRes.text();
      console.error('[transcribe] whisper failed', whisperRes.status, t.slice(0, 300));
      return NextResponse.json({ error: 'Transcription failed', details: t.slice(0, 200) }, { status: 502 });
    }
    const text = (await whisperRes.text()).trim();

    // Charged only on a transcription we actually got back.
    await consumeCredits(tenantId, 'transcription', {
      costEur: 0.003,
      metadata: { model: 'whisper-1', bytes: bytes.length },
    });

    return NextResponse.json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[transcribe] exception', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
