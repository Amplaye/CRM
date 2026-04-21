import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
import { assertAiSecret } from '@/lib/ai-auth';

export async function DELETE(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
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

     // Tenant-scoped fetch: a mismatched tenant_id produces a null row →
     // unified 404 response kills the cross-tenant side channel (no
     // distinction between "doesn't exist" and "wrong tenant").
     const { data: reservation, error: fetchErr } = await supabase
       .from('reservations')
       .select('*')
       .eq('id', reservation_id)
       .eq('tenant_id', tenant_id)
       .maybeSingle();

     if (fetchErr || !reservation) {
        return NextResponse.json({ success: false, error: "Reservation not found" }, { status: 404 });
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

     // If this was a pending waitlist offer, free the waitlist entry so it
     // can be re-offered to the same guest or a new candidate.
     await supabase
       .from('waitlist_entries')
       .update({
         status: 'waiting',
         matched_reservation_id: null,
         updated_at: new Date().toISOString(),
       })
       .eq('tenant_id', tenant_id)
       .eq('matched_reservation_id', reservation_id)
       .eq('status', 'offered');

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
