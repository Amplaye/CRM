import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
import { matchWaitlistForSlotAction } from '@/app/actions/waitlist';

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

    // Fuzzy phone match (same logic as confirm-pending)
    const { data: guests } = await supabase
      .from('guests')
      .select('id, phone')
      .eq('tenant_id', tenant_id);

    const matchIds = (guests || [])
      .filter((g: any) => {
        const gd = (g.phone || '').replace(/\D/g, '');
        return gd.length >= 7 && (gd.includes(phoneDigits) || phoneDigits.includes(gd));
      })
      .map((g: any) => g.id);

    if (matchIds.length === 0) {
      return NextResponse.json({ cancelled: false, message: "No guest found with that phone" });
    }

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

        // Audit
        await logAuditEvent({
          tenant_id,
          action: "cancel_reservation",
          entity_id: res.id,
          source: "ai_agent",
          details: { reason: "Cancelled via phone lookup", cancellation_source: source || "unknown" }
        });

        // Trigger waitlist matching for the freed slot
        await matchWaitlistForSlotAction(tenant_id, res.id, res.date, res.time, res.party_size);

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
