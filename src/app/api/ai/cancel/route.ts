import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { logAuditEvent } from '@/lib/audit';

export async function DELETE(request: Request) {
  try {
     const { searchParams } = new URL(request.url);
     const tenant_id = searchParams.get('tenant_id');
     const reservation_id = searchParams.get('reservation_id');

     if (!tenant_id || !reservation_id) {
        return NextResponse.json({ success: false, error: "Missing required params" }, { status: 400 });
     }

     const ref = db.collection('reservations').doc(reservation_id);
     const docSnap = await ref.get();

     if (!docSnap.exists) {
        return NextResponse.json({ success: false, error: "Reservation not found" }, { status: 404 });
     }

     if (docSnap.data()?.tenant_id !== tenant_id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
     }

     // Instead of hard deleting, we soft delete / status change
     await ref.update({
        status: 'cancelled',
        updated_at: Date.now()
     });

     await logAuditEvent(tenant_id, {
        action: "cancel_reservation",
        entity_id: ref.id,
        source: "ai_agent",
        details: { reason: "User requested cancellation via AI" }
     });

     return NextResponse.json({ 
        success: true, 
        message: "Reservation successfully cancelled." 
     });
     
  } catch (error: any) {
     console.error("Cancel Booking Error:", error);
     return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
