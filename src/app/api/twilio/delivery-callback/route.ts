import { NextResponse } from 'next/server';
import { logAuditEvent } from '@/lib/audit';
import { verifyTwilioSignature, isTwilioVerificationEnabled } from '@/lib/twilio-signature';

// Twilio status callbacks for outbound WhatsApp messages (queued → sent →
// delivered → read, or failed/undelivered). When enabled in the Twilio
// Console under "Status Callback URL", this gives us delivery tracking
// without polling Twilio's API.
//
// Signature verification follows the same on/off switch as the inbound
// webhook helper: only enforced when TWILIO_VERIFY_SIGNATURE=1 and
// TWILIO_AUTH_TOKEN is set. Each event is recorded as one row in
// audit_events for the matching tenant.
//
// Route: POST /api/twilio/delivery-callback?tenant_id=<uuid>
// Body: application/x-www-form-urlencoded (MessageSid, MessageStatus,
//       To, From, ErrorCode, etc.)
export async function POST(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id') || '';
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant_id query param' }, { status: 400 });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return NextResponse.json({ error: 'Expected form-urlencoded body' }, { status: 415 });
  }

  // Buffer the body once so we can parse + sign-check it.
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  if (isTwilioVerificationEnabled()) {
    const signature = request.headers.get('x-twilio-signature');
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    const fullUrl = `${proto}://${host}${url.pathname}${url.search}`;
    const ok = verifyTwilioSignature(fullUrl, params, signature);
    if (!ok) return NextResponse.json({ error: 'Bad Twilio signature' }, { status: 403 });
  }

  const messageSid = params.MessageSid || params.SmsSid || '';
  const status = params.MessageStatus || params.SmsStatus || 'unknown';
  if (!messageSid) {
    return NextResponse.json({ error: 'Missing MessageSid' }, { status: 400 });
  }

  // Dedup per (MessageSid, status): Twilio retries on 5xx and the same
  // status can arrive twice. idempotency_key keeps the audit clean.
  await logAuditEvent({
    tenant_id: tenantId,
    action: 'twilio_delivery_status',
    entity_id: messageSid,
    idempotency_key: `${messageSid}:${status}`,
    source: 'system',
    details: {
      status,
      to: params.To || '',
      from: params.From || '',
      errorCode: params.ErrorCode || null,
      errorMessage: params.ErrorMessage || null,
      apiVersion: params.ApiVersion || null,
      raw: params,
    },
  });

  return NextResponse.json({ ok: true });
}
