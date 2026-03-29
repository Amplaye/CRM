import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CreateBookingRequest, Reservation } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const payload: CreateBookingRequest = await request.json();

    if (!payload.tenant_id || !payload.idempotency_key || !payload.date || !payload.time || !payload.party_size) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // 1. Idempotency Check: Prevent double-booking if LLM retries the same tool call
    const { data: existingChecks } = await supabase
       .from('audit_events')
       .select('entity_id')
       .eq('tenant_id', payload.tenant_id)
       .eq('idempotency_key', payload.idempotency_key)
       .eq('action', 'create_reservation')
       .limit(1);

    if (existingChecks && existingChecks.length > 0) {
       return NextResponse.json({
          success: true,
          message: "Reservation already exists (Idempotent response)",
          reservation_id: existingChecks[0].entity_id
       });
    }

    // 2. Guest Verification / Creation
    let guestId: string;
    const { data: existingGuests } = await supabase
      .from('guests')
      .select('id, name')
      .eq('tenant_id', payload.tenant_id)
      .eq('phone', payload.guest_phone)
      .limit(1);

    if (existingGuests && existingGuests.length > 0) {
       guestId = existingGuests[0].id;
       // Update guest name if we now know it
       if (payload.guest_name && payload.guest_name !== "Unknown Guest" && existingGuests[0].name === "Unknown Guest") {
         await supabase.from('guests').update({ name: payload.guest_name }).eq('id', guestId);
       }
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

    // 3. Create Reservation
    const reservation = {
       tenant_id: payload.tenant_id,
       guest_id: guestId,
       date: payload.date,
       time: payload.time,
       party_size: payload.party_size,
       status: 'confirmed',
       source: payload.source || 'ai_voice',
       created_by_type: 'ai',
       notes: payload.notes || "",
       linked_conversation_id: payload.linked_conversation_id,
       created_at: new Date().toISOString(),
       updated_at: new Date().toISOString()
    };

    const { data: newRes, error: resErr } = await supabase
      .from('reservations')
      .insert(reservation)
      .select('id')
      .single();

    if (resErr) throw resErr;

    // 4. Log Audit Event
    await logAuditEvent({
       tenant_id: payload.tenant_id,
       action: "create_reservation",
       entity_id: newRes.id,
       idempotency_key: payload.idempotency_key,
       source: "ai_agent",
       details: {
          date: payload.date,
          time: payload.time,
          party_size: payload.party_size
       }
    });

    return NextResponse.json({
       success: true,
       reservation_id: newRes.id,
       status: "confirmed",
       message: "Reservation successfully created."
    });

  } catch (error: any) {
    console.error("Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
