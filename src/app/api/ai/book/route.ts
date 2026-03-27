import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { CreateBookingRequest, Reservation } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const payload: CreateBookingRequest = await request.json();

    if (!payload.tenant_id || !payload.idempotency_key || !payload.date || !payload.time || !payload.party_size) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // 1. Idempotency Check: Prevent double-booking if LLM retries the same tool call
    const existingChecks = await db.collection('audit_logs')
       .where('tenant_id', '==', payload.tenant_id)
       .where('idempotency_key', '==', payload.idempotency_key)
       .where('action', '==', 'create_reservation')
       .limit(1)
       .get();

    if (!existingChecks.empty) {
       const existingEvent = existingChecks.docs[0].data();
       return NextResponse.json({ 
          success: true, 
          message: "Reservation already exists (Idempotent response)", 
          reservation_id: existingEvent.entity_id 
       });
    }

    // 2. Guest Verification / Creation
    // In production, we'd do a fuzzy search or pure phone match
    let guestId = `guest_${Date.now()}`;
    const guestsSnap = await db.collection('guests')
      .where('tenant_id', '==', payload.tenant_id)
      .where('phone', '==', payload.guest_phone)
      .limit(1)
      .get();
    
    if (!guestsSnap.empty) {
       guestId = guestsSnap.docs[0].id;
    } else {
       // Create minimal guest record
       await db.collection('guests').doc(guestId).set({
          id: guestId,
          tenant_id: payload.tenant_id,
          phone: payload.guest_phone,
          name: payload.guest_name || "Unknown Guest",
          visit_count: 0,
          no_show_count: 0,
          cancellation_count: 0,
          tags: [],
          created_at: Date.now(),
          updated_at: Date.now()
       });
    }

    // 3. Create Reservation
    const ref = db.collection('reservations').doc();
    const reservation: Reservation = {
       id: ref.id,
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
       created_at: Date.now(),
       updated_at: Date.now()
    };

    await ref.set(reservation);

    // 4. Log Audit Event
    await logAuditEvent(payload.tenant_id, {
       action: "create_reservation",
       entity_id: ref.id,
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
       reservation_id: ref.id,
       status: "confirmed",
       message: "Reservation successfully created."
    });

  } catch (error: any) {
    console.error("Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
