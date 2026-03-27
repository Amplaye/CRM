import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { Incident } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    if (!payload.tenant_id || !payload.category || !payload.summary) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const ref = db.collection('incidents').doc();
    const incident: Incident = {
       id: ref.id,
       tenant_id: payload.tenant_id,
       guest_id: payload.guest_id, // optional
       category: payload.category, // e.g. "complaint"
       severity: payload.severity || 'medium',
       status: 'new',
       summary: payload.summary,
       linked_entity_id: payload.linked_conversation_id,
       created_at: Date.now(),
       updated_at: Date.now()
    };

    await ref.set(incident);

    // If this is specifically a handoff, we update the conversation status if linked
    if (payload.linked_conversation_id && payload.is_handoff) {
       await db.collection('conversations').doc(payload.linked_conversation_id).update({
          status: 'needs_human', // legacy usage -> wait, in indexing we called it outcome
          outcome: 'escalated',
          updated_at: Date.now()
       });
    }

    await logAuditEvent(payload.tenant_id, {
       action: "create_incident",
       entity_id: ref.id,
       source: "ai_agent",
       details: {
          category: incident.category,
          severity: incident.severity,
          is_handoff: !!payload.is_handoff
       }
    });

    return NextResponse.json({ 
       success: true, 
       incident_id: ref.id,
       message: payload.is_handoff ? "Handoff to human successful." : "Incident ticket created."
    });

  } catch (error: any) {
    console.error("Incident Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
