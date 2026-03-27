import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { ModifyBookingRequest, Reservation } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function PUT(request: Request) {
  try {
    const payload: ModifyBookingRequest = await request.json();

    if (!payload.tenant_id || !payload.reservation_id) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data: existingData, error: fetchErr } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', payload.reservation_id)
      .single();

    if (fetchErr || !existingData) {
       return NextResponse.json({ success: false, error: "Reservation not found" }, { status: 404 });
    }

    // Ensure the AI only touches its own tenant's data
    if (existingData.tenant_id !== payload.tenant_id) {
       return NextResponse.json({ success: false, error: "Unauthorized access" }, { status: 403 });
    }

    const updates: Partial<Reservation> = {
       updated_at: new Date().toISOString() as any
    };

    if (payload.date) updates.date = payload.date;
    if (payload.time) {
       // Ideally we'd do a capacity check here for the new time, similar to availability api
       updates.time = payload.time;
    }
    if (payload.party_size) updates.party_size = payload.party_size;
    if (payload.status) updates.status = payload.status;
    if (payload.notes) updates.notes = `${existingData.notes || ''}\n[AI Update]: ${payload.notes}`.trim();

    const { error: updateErr } = await supabase
      .from('reservations')
      .update(updates)
      .eq('id', payload.reservation_id);

    if (updateErr) throw updateErr;

    await logAuditEvent({
       tenant_id: payload.tenant_id,
       action: "modify_reservation",
       entity_id: payload.reservation_id,
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
       reservation_id: payload.reservation_id,
       message: "Reservation successfully updated."
    });

  } catch (error: any) {
    console.error("Modify Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
