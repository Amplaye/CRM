import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
import { assertAiSecret } from '@/lib/ai-auth';

export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  try {
    const payload = await request.json();

    if (!payload.tenant_id || !payload.guest_phone || !payload.requested_date || !payload.party_size) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Past date/time guard — Atlantic/Canary. Rejects waitlists for slots that
    // have already happened; wrappers filter client-side but the API is the
    // ultimate line of defense.
    {
      const _canaryNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Atlantic/Canary' }));
      const _today = _canaryNow.getFullYear() + '-' + String(_canaryNow.getMonth() + 1).padStart(2, '0') + '-' + String(_canaryNow.getDate()).padStart(2, '0');
      if (payload.requested_date < _today) {
        return NextResponse.json({ success: false, reason: 'past_date', message: 'No se puede poner en lista de espera para una fecha pasada.' }, { status: 409 });
      }
      if (payload.requested_date === _today && payload.requested_time) {
        const [hh, mm] = String(payload.requested_time).split(':').map(Number);
        if (Number.isFinite(hh) && Number.isFinite(mm)) {
          const reqMin = hh * 60 + mm;
          const nowMin = _canaryNow.getHours() * 60 + _canaryNow.getMinutes();
          if (reqMin <= nowMin) {
            return NextResponse.json({ success: false, reason: 'past_time', message: `A las ${payload.requested_time} ya ha pasado. ¿Para qué otro horario quieres esperar sitio?` }, { status: 409 });
          }
        }
      }
    }

    const supabase = createServiceRoleClient();

    // Find or create guest
    let guestId: string;
    const { data: existingGuests } = await supabase
      .from('guests')
      .select('id')
      .eq('tenant_id', payload.tenant_id)
      .eq('phone', payload.guest_phone)
      .limit(1);

    if (existingGuests && existingGuests.length > 0) {
      guestId = existingGuests[0].id;
    } else {
      const { data: newGuest, error: guestErr } = await supabase
        .from('guests')
        .insert({
          tenant_id: payload.tenant_id,
          phone: payload.guest_phone,
          name: payload.guest_name || "Unknown Guest",
          visit_count: 0,
          no_show_count: 0,
          cancellation_count: 0,
          tags: [],
          notes: "",
        })
        .select('id')
        .single();

      if (guestErr) throw guestErr;
      guestId = newGuest.id;
    }

    // Insert waitlist entry with correct column names
    const { data: newEntry, error: insertErr } = await supabase
      .from('waitlist_entries')
      .insert({
        tenant_id: payload.tenant_id,
        guest_id: guestId,
        date: payload.requested_date,
        target_time: payload.requested_time || "20:00",
        party_size: payload.party_size,
        status: 'waiting',
        contact_preference: payload.channel === 'voice' ? 'call' : 'whatsapp',
        priority_score: payload.is_vip ? 100 : 50,
        acceptable_time_range: { start: "18:00", end: "22:00" },
        notes: payload.notes || "",
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;

    await logAuditEvent({
      tenant_id: payload.tenant_id,
      action: "create_waitlist",
      entity_id: newEntry.id,
      source: "ai_agent",
      details: {
        requested_date: payload.requested_date,
        requested_time: payload.requested_time,
        party_size: payload.party_size
      }
    });

    return NextResponse.json({
      success: true,
      waitlist_id: newEntry.id,
      message: "Guest successfully added to waitlist."
    });

  } catch (error: any) {
    console.error("Waitlist Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error", details: error.message }, { status: 500 });
  }
}
