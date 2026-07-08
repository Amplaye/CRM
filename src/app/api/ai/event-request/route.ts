import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
import { assertAiSecret } from '@/lib/ai-auth';
import { assertActivePlan } from '@/lib/billing/guard';
import { isE164, normalizePhone, phoneTail } from '@/lib/booking-validation';
import { sendPushToTenant } from '@/lib/push/send';

/**
 * AI event-request intake.
 *
 * When the chatbot recognises a PRIVATE-EVENT / large-commission request
 * (party with catering, lots of guests, invoice/VAT, venue rental, custom
 * quote…) it does NOT try to book it through the normal funnel. Instead it
 * drops the lead here: we upsert the guest and create an `escalated`
 * reservation tagged `event_request`, with a concise human-readable summary in
 * `notes`, so it surfaces on the CRM "In attesa" (/pending) page for the owner
 * to call the customer back.
 *
 * A private event has no firm date/time/party_size, but the `reservations`
 * table requires them (NOT NULL). We use whatever the bot could extract from
 * the conversation, falling back to a neutral placeholder (today + 20:00 +
 * party_size 2). The owner re-negotiates everything by phone anyway — the row
 * is a callback ticket, not a confirmed booking.
 */
export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  try {
    const payload = await request.json();

    if (!payload.tenant_id || !payload.guest_phone) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields (tenant_id, guest_phone)' },
        { status: 400 }
      );
    }

    // Phone validation (tolerant: Meta delivers digits without +)
    const phoneStr = String(payload.guest_phone).trim();
    if (phoneStr.length > 0 && !isE164(phoneStr)) {
      return NextResponse.json(
        { success: false, error: 'Invalid guest_phone format — expected E.164 (e.g. +34612345678)' },
        { status: 400 }
      );
    }
    const canonicalPhone = normalizePhone(payload.guest_phone);
    const lookupTail = phoneTail(payload.guest_phone);

    const noPlan = await assertActivePlan(payload.tenant_id);
    if (noPlan) return noPlan;

    const supabase = createServiceRoleClient();

    // ── Find or create guest (tolerant tail match, same idiom as /api/ai/book) ──
    let guestId: string;
    const { data: existingGuestsRaw } = await supabase
      .from('guests')
      .select('id, name, phone')
      .eq('tenant_id', payload.tenant_id);

    const existingGuests = (existingGuestsRaw || []).filter(
      (g: { id: string; name: string | null; phone: string | null }) =>
        phoneTail(g.phone) === lookupTail
    );

    if (existingGuests.length > 0) {
      guestId = existingGuests[0].id;
      // Refresh the name if the bot learned a better one
      const newName = (payload.guest_name || '').trim();
      if (newName && newName !== existingGuests[0].name) {
        await supabase.from('guests').update({ name: newName }).eq('id', guestId);
      }
    } else {
      const { data: newGuest, error: guestErr } = await supabase
        .from('guests')
        .insert({
          tenant_id: payload.tenant_id,
          phone: canonicalPhone || payload.guest_phone,
          name: (payload.guest_name || '').trim() || 'Richiesta evento',
          visit_count: 0,
          no_show_count: 0,
          cancellation_count: 0,
          tags: [],
          notes: '',
        })
        .select('id')
        .single();
      if (guestErr) throw guestErr;
      guestId = newGuest.id;
    }

    // ── Best-effort date/time/party_size (NOT NULL on reservations) ─────────────
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Atlantic/Canary' }));
    const todayCanary =
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');

    const dateOk = typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date);
    const timeOk = typeof payload.time === 'string' && /^\d{2}:\d{2}$/.test(payload.time);
    const resDate = dateOk ? payload.date : todayCanary;
    const resTime = timeOk ? payload.time : '20:00';
    const partySize =
      Number.isFinite(payload.party_size) && payload.party_size > 0
        ? Math.min(Math.round(payload.party_size), 999)
        : 2;

    const lang = ['es', 'it', 'en', 'de'].includes(payload.language) ? payload.language : null;

    // Concise summary in notes — the bot sends a short, owner-facing recap.
    const summary = String(payload.summary || payload.notes || '').trim().slice(0, 1200);

    const reservation: Record<string, unknown> = {
      tenant_id: payload.tenant_id,
      guest_id: guestId,
      date: resDate,
      time: resTime,
      party_size: partySize,
      status: 'escalated',
      source: 'ai_chat',
      created_by_type: 'ai',
      tags: ['event_request'],
      notes: summary,
      language: lang,
      linked_conversation_id: payload.conversation_id || null,
    };

    const { data: inserted, error: insErr } = await supabase
      .from('reservations')
      .insert(reservation)
      .select('id')
      .single();
    if (insErr) throw insErr;

    await logAuditEvent({
      tenant_id: payload.tenant_id,
      action: 'event_request_created',
      entity_id: inserted.id,
      source: 'ai_agent',
      details: {
        guest_id: guestId,
        date_estimate: dateOk ? resDate : null,
        party_size_estimate: Number.isFinite(payload.party_size) ? payload.party_size : null,
        has_summary: !!summary,
      },
    });

    void sendPushToTenant(payload.tenant_id, 'reservation_escalated', {
      name: payload.guest_name, date: resDate, time: resTime, party: partySize,
    });

    return NextResponse.json({
      success: true,
      event_request: true,
      reservation_id: inserted.id,
    });
  } catch (err) {
    console.error('event-request error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
