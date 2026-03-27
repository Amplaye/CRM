import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { WaitlistEntry } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    if (!payload.tenant_id || !payload.guest_phone || !payload.requested_date || !payload.party_size) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Reuse existing guest lookup pattern
    let guestId = `guest_${Date.now()}`;
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
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
         })
         .select('id')
         .single();

       if (guestErr) throw guestErr;
       guestId = newGuest.id;
    }

    const entry = {
       tenant_id: payload.tenant_id,
       guest_id: guestId,
       requested_date: payload.requested_date,
       requested_time: payload.requested_time || "any",
       party_size: payload.party_size,
       status: 'waiting',
       contact_channel: payload.channel === 'voice' ? 'phone' : 'whatsapp',
       priority_score: payload.is_vip ? 100 : 0,
       created_at: new Date().toISOString(),
       updated_at: new Date().toISOString()
    };

    const { data: newEntry, error: insertErr } = await supabase
      .from('waitlist')
      .insert(entry)
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
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
