import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { Conversation } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    // Expecting WebhookIngestionRequest Payload

    if (!payload.tenant_id || !payload.guest_phone) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // 1. Establish Guest Context
    let guestId = `guest_${Date.now()}`;
    const { data: existingGuests } = await supabase
      .from('guests')
      .select('id')
      .eq('tenant_id', payload.tenant_id)
      .eq('phone', payload.guest_phone)
      .limit(1);

    if (existingGuests && existingGuests.length > 0) {
       guestId = existingGuests[0].id;
    }

    // 2. Ingest Conversation
    const conversation = {
       tenant_id: payload.tenant_id,
       guest_id: guestId,
       channel: payload.channel || "whatsapp",
       intent: payload.intent || "unknown",
       outcome: payload.outcome || "resolved",
       sentiment: payload.sentiment || "neutral",
       summary: payload.summary || payload.message || "No summary provided",
       transcript: payload.transcript || [],
       created_at: new Date().toISOString(),
       updated_at: new Date().toISOString()
    };

    // Store the conversation directly into the main operational table
    const { data: newConvo, error: insertErr } = await supabase
      .from('conversations')
      .insert(conversation)
      .select('id')
      .single();

    if (insertErr) throw insertErr;

    // 3. Optional: Link to a reservation if an intent requires it or LLM specifies it
    // If payload contains an executed action idempotency key, we could link it here.

    // 4. Fire Webhook Audit log
    await logAuditEvent({
       tenant_id: payload.tenant_id,
       action: payload.outcome === 'escalated' ? 'handoff' : 'create_incident',
       entity_id: newConvo.id,
       source: "ai_agent",
       details: {
          channel: conversation.channel,
          intent: conversation.intent,
          outcome: conversation.outcome
       }
    });

    return NextResponse.json({
      success: true,
      message: "Webhook processed and ingested into Conversation Inbox",
      conversation_id: newConvo.id
    });

  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
