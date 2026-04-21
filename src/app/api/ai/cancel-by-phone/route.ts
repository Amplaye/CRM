import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
import { assertAiSecret } from '@/lib/ai-auth';

/**
 * Cancel a reservation by guest phone number.
 * Used by n8n when a client replies to a reminder with "cancelar" / "no vengo".
 *
 * POST /api/ai/cancel-by-phone
 * Body: { tenant_id, guest_phone, cancellation_source }
 *
 * cancellation_source values:
 *   - reminder_24h: cancelled after 24h reminder
 *   - reminder_4h: cancelled after same-day (4h) reminder
 *   - chat_spontaneous: cancelled via WhatsApp without reminder prompt
 *   - voice_spontaneous: cancelled via voice call without reminder prompt
 *   - auto_noshow: auto-cancelled by no-show workflow
 */
export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  try {
    const { tenant_id, guest_phone, cancellation_source } = await request.json();
    if (!tenant_id || !guest_phone) {
      return NextResponse.json({ cancelled: false, error: "Missing tenant_id or guest_phone" }, { status: 400 });
    }

    const validSources = ['reminder_24h', 'reminder_4h', 'chat_spontaneous', 'voice_spontaneous', 'auto_noshow', 'staff', 'web'];
    const source = cancellation_source && validSources.includes(cancellation_source)
      ? cancellation_source
      : null;

    const supabase = createServiceRoleClient();
    const phoneDigits = guest_phone.replace(/\D/g, '');

    // Deterministic phone match — compare the last 9 digits (E.164
    // subscriber part) instead of the old cross-includes() which could
    // match a short shared suffix ("1234567" inside two unrelated numbers).
    // Abort if more than one guest matches so we never cancel the wrong
    // reservation silently.
    const target = phoneDigits.slice(-9);
    const { data: guests } = await supabase
      .from('guests')
      .select('id, phone')
      .eq('tenant_id', tenant_id);

    const matches = (guests || []).filter((g: any) => {
      const gd = (g.phone || '').replace(/\D/g, '');
      if (gd.length < 7) return false;
      return gd.slice(-9) === target || (gd.length < 9 && target.endsWith(gd));
    });

    if (matches.length === 0) {
      return NextResponse.json({ cancelled: false, message: "No guest found with that phone" });
    }
    if (matches.length > 1) {
      return NextResponse.json({
        cancelled: false,
        error: 'Multiple reservations match this phone — need a reservation_id to disambiguate',
      }, { status: 409 });
    }

    const matchIds = matches.map((g: any) => g.id);

    // Find the nearest upcoming active reservation for any matching guest
    const today = new Date().toISOString().slice(0, 10);
    for (const gid of matchIds) {
      const { data: upcoming } = await supabase
        .from('reservations')
        .select('id, date, time, party_size')
        .eq('tenant_id', tenant_id)
        .eq('guest_id', gid)
        .in('status', ['confirmed', 'pending_confirmation'])
        .gte('date', today)
        .order('date', { ascending: true })
        .order('time', { ascending: true })
        .limit(1);

      if (upcoming && upcoming.length > 0) {
        const res = upcoming[0];
        const updateData: Record<string, any> = {
          status: 'cancelled',
          updated_at: new Date().toISOString()
        };
        if (source) updateData.cancellation_source = source;

        await supabase
          .from('reservations')
          .update(updateData)
          .eq('id', res.id);

        // If this reservation was an active waitlist offer, free the entry
        // back to `waiting` so a new offer can be made (either to the same
        // guest on a future cycle or to the next candidate).
        await supabase
          .from('waitlist_entries')
          .update({
            status: 'waiting',
            matched_reservation_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', tenant_id)
          .eq('matched_reservation_id', res.id)
          .eq('status', 'offered');

        // Audit
        await logAuditEvent({
          tenant_id,
          action: "cancel_reservation",
          entity_id: res.id,
          source: "ai_agent",
          details: { reason: "Cancelled via phone lookup", cancellation_source: source || "unknown" }
        });

        return NextResponse.json({
          cancelled: true,
          reservation_id: res.id,
          cancellation_source: source,
          date: res.date,
          time: res.time
        });
      }
    }

    return NextResponse.json({ cancelled: false, message: "No upcoming reservation found for this guest" });
  } catch (error: any) {
    console.error("Cancel by phone error:", error);
    return NextResponse.json({ cancelled: false, error: error.message }, { status: 500 });
  }
}
