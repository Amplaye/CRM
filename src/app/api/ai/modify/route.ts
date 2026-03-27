import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { ModifyBookingRequest, Reservation } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function PUT(request: Request) {
  try {
    const payload: ModifyBookingRequest = await request.json();

    if (!payload.tenant_id || !payload.reservation_id) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const ref = db.collection('reservations').doc(payload.reservation_id);
    const docSnap = await ref.get();

    if (!docSnap.exists) {
       return NextResponse.json({ success: false, error: "Reservation not found" }, { status: 404 });
    }

    const existingData = docSnap.data() as Reservation;
    
    // Ensure the AI only touches its own tenant's data
    if (existingData.tenant_id !== payload.tenant_id) {
       return NextResponse.json({ success: false, error: "Unauthorized access" }, { status: 403 });
    }

    const updates: Partial<Reservation> = {
       updated_at: Date.now()
    };

    if (payload.date) updates.date = payload.date;
    if (payload.time) {
       // Ideally we'd do a capacity check here for the new time, similar to availability api
       updates.time = payload.time;
    }
    if (payload.party_size) updates.party_size = payload.party_size;
    if (payload.status) updates.status = payload.status;
    if (payload.notes) updates.notes = `${existingData.notes || ''}\n[AI Update]: ${payload.notes}`.trim();

    await ref.update(updates);

    await logAuditEvent(payload.tenant_id, {
       action: "modify_reservation",
       entity_id: ref.id,
       source: "ai_agent",
       details: {
          previous: {
             date: existingData.date,
             time: existingData.time,
             party_size: existingData.party_size
          },
          updates
       }
    });

    return NextResponse.json({ 
       success: true, 
       reservation_id: ref.id,
       message: "Reservation successfully updated."
    });

  } catch (error: any) {
    console.error("Modify Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
