import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { tenantReceivesTraffic, type TenantStatus } from '@/lib/tenants/status';
import { normalizePhone } from '@/lib/booking-validation';

// Owner echo intake — the Coexistence "human takeover" trigger.
//
// When the owner replies to a customer manually from the WhatsApp Business App
// (instead of the CRM inbox), WhatsApp mirrors that message to the BSP webhook
// as an `smb_message_echoes` event. The BSP adapter (n8n) forwards it here.
//
// Two effects:
//   1. The owner's message is appended to the conversation transcript (role
//      'staff') so it shows in the CRM chat AND the bot can read it when it
//      later resumes — it picks up the context the owner already discussed.
//   2. A MANUAL HOLD takeover is set on the guest: bot_paused_at = now() and
//      bot_paused_hold = true. Unlike the CRM-inbox 60s cooldown, a hold does
//      NOT auto-resume — the bot stays silent until the owner taps "Completa
//      col bot" in the CRM (/api/conversations/resume-bot), because the
//      customer may answer slowly and a timer would re-wake the bot mid-chat.
//
// This endpoint is also the test seam: with no real Coexistence number yet, the
// E2E harness POSTs a simulated echo here, shaped exactly like what the BSP
// adapter will send, so the whole takeover → resume flow is verifiable today.
//
// Auth: shared x-ai-secret (same fail-closed gate as incoming-message), since
// it writes guest PII + transcript with the service-role client.
export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  try {
    const payload = await request.json();

    const tenantId: string = payload.tenant_id;
    const guestPhone: string = payload.guest_phone;
    // The owner's manually-typed text. Accept a couple of field aliases so the
    // BSP adapter can map `smb_message_echoes` text without renaming.
    const ownerText: string = String(
      payload.owner_text ?? payload.text ?? payload.message ?? ''
    ).trim();

    if (!tenantId || !guestPhone) {
      return NextResponse.json({ error: 'Missing tenant_id or guest_phone' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Authorize the body-supplied tenant_id (same as incoming-message).
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('id, status')
      .eq('id', tenantId)
      .single();
    if (!tenantReceivesTraffic(tenantRow?.status as TenantStatus)) {
      return NextResponse.json({ error: 'Unknown or inactive tenant' }, { status: 403 });
    }

    // Resolve the guest by fuzzy phone match (handles +34xxx vs xxx), same as
    // incoming-message. The customer messaged first so a guest normally exists;
    // create one defensively if not.
    const phoneDigits = (guestPhone || '').replace(/\D/g, '');
    const { data: allGuests } = await supabase
      .from('guests')
      .select('id, name, phone')
      .eq('tenant_id', tenantId);

    const matched = (allGuests || []).find((g: any) => {
      const gd = (g.phone || '').replace(/\D/g, '');
      if (!gd || gd.length < 7 || !phoneDigits || phoneDigits.length < 7) return false;
      return gd.includes(phoneDigits) || phoneDigits.includes(gd);
    });

    let guestId: string;
    if (matched) {
      guestId = matched.id;
    } else {
      const { data: newGuest, error: gErr } = await supabase
        .from('guests')
        .insert({
          phone: normalizePhone(guestPhone) || guestPhone,
          tenant_id: tenantId,
          name: payload.guest_name || 'Unknown Guest',
          visit_count: 0,
          no_show_count: 0,
          cancellation_count: 0,
          tags: [],
          notes: '',
        })
        .select('id')
        .single();
      if (gErr) throw gErr;
      guestId = newGuest.id;
    }

    // Append the owner's message (role 'staff') to the active conversation so it
    // shows in the CRM chat and is visible to the bot on resume.
    if (ownerText) {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, transcript')
        .eq('tenant_id', tenantId)
        .eq('guest_id', guestId)
        .eq('channel', 'whatsapp')
        .in('status', ['active', 'escalated'])
        .order('created_at', { ascending: false })
        .limit(1);

      const entry = { role: 'staff', content: ownerText, timestamp: Date.now() };
      if (convs && convs.length > 0) {
        const existing = convs[0];
        const tx = Array.isArray(existing.transcript) ? existing.transcript : [];
        await supabase
          .from('conversations')
          .update({ transcript: [...tx, entry], updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('conversations').insert({
          tenant_id: tenantId,
          guest_id: guestId,
          channel: 'whatsapp',
          intent: 'unknown',
          status: 'active',
          summary: 'Conversazione gestita dal titolare',
          transcript: [entry],
        });
      }
    }

    // Set the MANUAL HOLD takeover. The engine's Fetch History guard reads both
    // fields: bot_paused_hold=true keeps the bot silent regardless of age.
    const { error: uErr } = await supabase
      .from('guests')
      .update({ bot_paused_at: new Date().toISOString(), bot_paused_hold: true })
      .eq('id', guestId);
    if (uErr) throw uErr;

    return NextResponse.json({ success: true, guest_id: guestId, hold: true });
  } catch (e: any) {
    console.error('owner-echo error:', e);
    return NextResponse.json({ error: 'Internal Server Error', details: e.message }, { status: 500 });
  }
}
