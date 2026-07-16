import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { Incident } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';
import { assertAiSecret } from '@/lib/ai-auth';

export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  try {
    const payload = await request.json();

    if (!payload.tenant_id || !payload.category || !payload.summary) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const incident = {
       tenant_id: payload.tenant_id,
       guest_id: payload.guest_id, // optional
       category: payload.category, // e.g. "complaint"
       severity: payload.severity || 'medium',
       status: 'new',
       summary: payload.summary,
       linked_entity_id: payload.linked_conversation_id,
       created_at: new Date().toISOString(),
       updated_at: new Date().toISOString()
    };

    const { data: newIncident, error: insertErr } = await supabase
      .from('incidents')
      .insert(incident)
      .select('id')
      .single();

    if (insertErr) throw insertErr;

    // If this is specifically a handoff, we update the conversation status if linked
    if (payload.linked_conversation_id && payload.is_handoff) {
       const { error: updateErr } = await supabase
         .from('conversations')
         .update({
            status: 'needs_human',
            outcome: 'escalated',
            updated_at: new Date().toISOString()
         })
         .eq('id', payload.linked_conversation_id);

       if (updateErr) console.error("Failed to update conversation for handoff:", updateErr);
    }

    await logAuditEvent({
       tenant_id: payload.tenant_id,
       action: "create_incident",
       entity_id: newIncident.id,
       source: "ai_agent",
       details: {
          category: incident.category,
          severity: incident.severity,
          is_handoff: !!payload.is_handoff
       }
    });

    return NextResponse.json({
       success: true,
       incident_id: newIncident.id,
       message: payload.is_handoff ? "Handoff to human successful." : "Incident ticket created."
    });

  } catch (error: any) {
    console.error("Incident Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
