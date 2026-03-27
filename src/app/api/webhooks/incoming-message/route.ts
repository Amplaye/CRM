import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase/admin';
import { Conversation } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    
    // Expecting WebhookIngestionRequest Payload

    if (!payload.tenant_id || !payload.guest_phone) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Establish Guest Context
    let guestId = `guest_${Date.now()}`;
    const guestsSnap = await db.collection('guests')
      .where('tenant_id', '==', payload.tenant_id)
      .where('phone', '==', payload.guest_phone)
      .limit(1)
      .get();
      
    if (!guestsSnap.empty) {
       guestId = guestsSnap.docs[0].id;
    }

    // 2. Ingest Conversation
    const conversationRef = db.collection('conversations').doc();
    const conversation: Conversation = {
       id: conversationRef.id,
       tenant_id: payload.tenant_id,
       guest_id: guestId, // Currently we use guest_id everywhere, but UI hacks it to show phone if needed
       channel: payload.channel || "whatsapp",
       intent: payload.intent || "unknown",
       outcome: payload.outcome || "resolved",
       sentiment: payload.sentiment || "neutral",
       summary: payload.summary || payload.message || "No summary provided",
       transcript: payload.transcript || [],
       created_at: Date.now(),
       updated_at: Date.now()
    };

    // Store the conversation directly into the main operational collection
    await conversationRef.set(conversation);
    
    // 3. Optional: Link to a reservation if an intent requires it or LLM specifies it
    // If payload contains an executed action idempotency key, we could link it here.
    
    // 4. Fire Webhook Audit log
    await logAuditEvent(payload.tenant_id, {
       action: payload.outcome === 'escalated' ? 'handoff' : 'create_incident', // Using generic action if unknown
       entity_id: conversationRef.id,
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
      conversation_id: conversationRef.id 
    });
    
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
