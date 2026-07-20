import { NextResponse } from 'next/server';
import { logAuditEvent } from '@/lib/audit';
import { handleMetaWebhookVerification, verifyMetaSignature } from '@/lib/meta-signature';
import { logSystemEvent } from '@/lib/system-log';

// Meta WhatsApp Cloud API delivery status webhook (sent → delivered → read, or
// failed). The only delivery-status surface: the Twilio status callback it
// replaced was deleted on 2026-07-20. Each status update is recorded as one row
// in audit_events for the matching tenant.
//
// Meta posts a webhook envelope; statuses live at
//   entry[].changes[].value.statuses[] = [{ id, status, recipient_id,
//                                            timestamp, errors? }]
// `id` is the wamid of the original OUTBOUND message we sent.
//
// Route: POST /api/webhooks/whatsapp-delivery?tenant_id=<uuid>
// Signature verification reuses the Meta helper (FACEBOOK_VERIFY_SIGNATURE=1
// + META_APP_SECRET to enable). The GET handshake is supported so this URL can
// be registered directly with Meta if desired.

export async function GET(request: Request) {
  const verification = handleMetaWebhookVerification(request);
  if (verification) return verification;
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id') || '';
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant_id query param' }, { status: 400 });
  }

  // M1: this route writes audit_events for an arbitrary tenant_id, so an
  // unauthenticated caller could forge delivery history. Verify the Meta
  // HMAC over the raw body (fail-closed whenever META_APP_SECRET is set).
  // Read the body once as text and reuse it for both verification and parsing.
  const rawBody = await request.text();
  if (!verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    await logSystemEvent({
      category: 'webhook_failure',
      severity: 'high',
      title: 'Meta delivery webhook rejected',
      description: 'Invalid or missing X-Hub-Signature-256 on /api/webhooks/whatsapp-delivery.',
      error_key: 'whatsapp-delivery-bad-signature',
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Collect statuses from the Meta envelope (tolerant of n8n-flattened shapes:
  // a bare { statuses: [...] } or even a single status object also work).
  const statuses: any[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      for (const s of change?.value?.statuses || []) statuses.push(s);
    }
  }
  if (statuses.length === 0 && Array.isArray(payload?.statuses)) statuses.push(...payload.statuses);
  if (statuses.length === 0 && payload?.id && payload?.status) statuses.push(payload);

  if (statuses.length === 0) {
    // Not a status webhook (could be an inbound-message envelope hitting the
    // wrong route, or a verification ping) — ack so Meta doesn't retry.
    return NextResponse.json({ ok: true, recorded: 0 });
  }

  let recorded = 0;
  for (const s of statuses) {
    const messageId = s.id || s.message_id || '';
    const status = s.status || 'unknown';
    if (!messageId) continue;

    const firstError = Array.isArray(s.errors) && s.errors.length > 0 ? s.errors[0] : null;

    // Dedup per (wamid, status): Meta can deliver the same status twice.
    await logAuditEvent({
      tenant_id: tenantId,
      action: 'whatsapp_delivery_status',
      entity_id: messageId,
      idempotency_key: `${messageId}:${status}`,
      source: 'system',
      details: {
        provider: 'meta',
        status,
        recipient: s.recipient_id || '',
        timestamp: s.timestamp || null,
        errorCode: firstError?.code ?? null,
        errorMessage: firstError?.title || firstError?.message || null,
        raw: s,
      },
    });
    recorded++;
  }

  return NextResponse.json({ ok: true, recorded });
}
