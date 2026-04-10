import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';

export async function DELETE(request: Request) {
  try {
     const { searchParams } = new URL(request.url);
     const tenant_id = searchParams.get('tenant_id');
     const reservation_id = searchParams.get('reservation_id');
     const cancellation_source = searchParams.get('cancellation_source');

     if (!tenant_id || !reservation_id) {
        return NextResponse.json({ success: false, error: "Missing required params" }, { status: 400 });
     }

     const validSources = ['reminder_24h', 'reminder_4h', 'chat_spontaneous', 'voice_spontaneous', 'auto_noshow', 'staff', 'web'];

     const supabase = createServiceRoleClient();

     const { data: reservation, error: fetchErr } = await supabase
       .from('reservations')
       .select('*')
       .eq('id', reservation_id)
       .single();

     if (fetchErr || !reservation) {
        return NextResponse.json({ success: false, error: "Reservation not found" }, { status: 404 });
     }

     if (reservation.tenant_id !== tenant_id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
     }

     // Instead of hard deleting, we soft delete / status change
     const updateData: Record<string, any> = {
        status: 'cancelled',
        updated_at: new Date().toISOString()
     };
     if (cancellation_source && validSources.includes(cancellation_source)) {
        updateData.cancellation_source = cancellation_source;
     }

     const { error: updateErr } = await supabase
       .from('reservations')
       .update(updateData)
       .eq('id', reservation_id);

     if (updateErr) throw updateErr;

     await logAuditEvent({
        tenant_id,
        action: "cancel_reservation",
        entity_id: reservation_id,
        source: "ai_agent",
        details: { reason: "User requested cancellation via AI", cancellation_source: cancellation_source || "unknown" }
     });

     return NextResponse.json({
        success: true,
        message: "Reservation successfully cancelled.",
        cancellation_source: cancellation_source || null
     });

  } catch (error: any) {
     console.error("Cancel Booking Error:", error);
     return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
