import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { WaitlistEntry } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    if (!payload.tenant_id || !payload.guest_phone || !payload.requested_date || !payload.party_size) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Reuse existing guest lookup pattern
    let guestId = `guest_${Date.now()}`;
    const guestsSnap = await db.collection('guests')
      .where('tenant_id', '==', payload.tenant_id)
      .where('phone', '==', payload.guest_phone)
      .limit(1)
      .get();
    
    if (!guestsSnap.empty) {
       guestId = guestsSnap.docs[0].id;
    } else {
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

    const ref = db.collection('waitlist').doc();
    const entry: WaitlistEntry = {
       id: ref.id,
       tenant_id: payload.tenant_id,
       guest_id: guestId,
       requested_date: payload.requested_date,
       requested_time: payload.requested_time || "any",
       party_size: payload.party_size,
       status: 'waiting',
       contact_channel: payload.channel === 'voice' ? 'phone' : 'whatsapp',
       priority_score: payload.is_vip ? 100 : 0, // Simplified VIP scoring from payload flags
       created_at: Date.now(),
       updated_at: Date.now()
    };

    await ref.set(entry);

    await logAuditEvent(payload.tenant_id, {
       action: "create_waitlist",
       entity_id: ref.id,
       source: "ai_agent",
       details: {
          requested_date: payload.requested_date,
          requested_time: payload.requested_time,
          party_size: payload.party_size
       }
    });

    return NextResponse.json({ 
       success: true, 
       waitlist_id: ref.id,
       message: "Guest successfully added to waitlist."
    });

  } catch (error: any) {
    console.error("Waitlist Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
