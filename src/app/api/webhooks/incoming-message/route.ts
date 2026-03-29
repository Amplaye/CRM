import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    if (!payload.tenant_id || !payload.guest_phone) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // 1. Find or create guest
    let guestId: string;
    const { data: existingGuests } = await supabase
      .from('guests')
      .select('id')
      .eq('tenant_id', payload.tenant_id)
      .eq('phone', payload.guest_phone)
      .limit(1);

    if (existingGuests && existingGuests.length > 0) {
      guestId = existingGuests[0].id;
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

    // 2. Map outcome to conversation status
    const statusMap: Record<string, string> = {
      resolved: "resolved",
      escalated: "escalated",
      abandoned: "abandoned",
    };
    const status = statusMap[payload.outcome] || "active";

    // 3. Insert conversation
    const { data: newConvo, error: insertErr } = await supabase
      .from('conversations')
      .insert({
        tenant_id: payload.tenant_id,
        guest_id: guestId,
        channel: payload.channel || "whatsapp",
        intent: payload.intent || "unknown",
        status,
        escalation_flag: payload.outcome === "escalated",
        sentiment: payload.sentiment || "neutral",
        summary: payload.summary || payload.message || "No summary provided",
        transcript: payload.transcript || [],
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;

    // 4. Audit log
    await logAuditEvent({
      tenant_id: payload.tenant_id,
      action: status === 'escalated' ? 'handoff' : 'create_incident',
      entity_id: newConvo.id,
      source: "ai_agent",
      details: {
        channel: payload.channel || "whatsapp",
        intent: payload.intent || "unknown",
        status,
      }
    });

    return NextResponse.json({
      success: true,
      message: "Conversation ingested successfully",
      conversation_id: newConvo.id
    });

  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
  }
}
