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

    // 1. Find or create guest (fuzzy phone match to handle +34xxx vs xxx)
    let guestId: string;
    let guestName = payload.guest_name || "";
    const phoneDigits = (payload.guest_phone || '').replace(/\D/g, '');

    const { data: allGuests } = await supabase
      .from('guests')
      .select('id, name, phone')
      .eq('tenant_id', payload.tenant_id);

    const matchedGuest = (allGuests || []).find((g: any) => {
      const gDigits = (g.phone || '').replace(/\D/g, '');
      if (!gDigits || gDigits.length < 7 || !phoneDigits || phoneDigits.length < 7) return false;
      return gDigits.includes(phoneDigits) || phoneDigits.includes(gDigits);
    });

    if (matchedGuest) {
      guestId = matchedGuest.id;
      // Update guest name if we now know it and it was unknown
      if (guestName && guestName !== "Unknown Guest" && matchedGuest.name === "Unknown Guest") {
        await supabase.from('guests').update({ name: guestName }).eq('id', guestId);
      }
    } else {
      const { data: newGuest, error: guestErr } = await supabase
        .from('guests')
        .insert({
          tenant_id: payload.tenant_id,
          phone: payload.guest_phone,
          name: guestName || "Unknown Guest",
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

    // 2. Find existing active conversation for this guest
    const { data: existingConvos } = await supabase
      .from('conversations')
      .select('id, transcript, status')
      .eq('tenant_id', payload.tenant_id)
      .eq('guest_id', guestId)
      .eq('channel', payload.channel || 'whatsapp')
      .in('status', ['active', 'escalated'])
      .order('created_at', { ascending: false })
      .limit(1);

    const newMessages = payload.transcript || [];
    const summaryText = payload.summary || payload.message || "";

    if (existingConvos && existingConvos.length > 0) {
      // --- UPDATE existing conversation ---
      const existing = existingConvos[0];
      const existingTranscript = Array.isArray(existing.transcript) ? existing.transcript : [];

      // Append new messages to existing transcript
      const updatedTranscript = [...existingTranscript, ...newMessages];

      const updates: any = {
        transcript: updatedTranscript,
        updated_at: new Date().toISOString(),
      };

      // Update summary if provided
      if (summaryText) updates.summary = summaryText;
      // Update intent if provided
      if (payload.intent && payload.intent !== 'unknown') updates.intent = payload.intent;
      // Update sentiment if provided
      if (payload.sentiment) updates.sentiment = payload.sentiment;
      // Update language if provided (es/it/en) — used by reminder cron to
      // pick the right WhatsApp template per guest.
      if (payload.language && ['es', 'it', 'en', 'de'].includes(payload.language)) {
        updates.language = payload.language;
      }
      // Update status if outcome says resolved
      if (payload.outcome === 'resolved') updates.status = 'resolved';
      if (payload.outcome === 'escalated') {
        updates.status = 'escalated';
        updates.escalation_flag = true;
      }

      await supabase.from('conversations').update(updates).eq('id', existing.id);

      return NextResponse.json({
        success: true,
        message: "Conversation updated",
        conversation_id: existing.id,
        action: "updated"
      });

    } else {
      // --- CREATE new conversation ---
      const statusMap: Record<string, string> = {
        resolved: "resolved",
        escalated: "escalated",
        abandoned: "abandoned",
      };
      const status = statusMap[payload.outcome] || "active";

      const insertPayload: Record<string, any> = {
        tenant_id: payload.tenant_id,
        guest_id: guestId,
        channel: payload.channel || "whatsapp",
        intent: payload.intent || "unknown",
        status,
        escalation_flag: payload.outcome === "escalated",
        sentiment: payload.sentiment || "neutral",
        summary: summaryText || "New conversation",
        transcript: newMessages,
      };
      if (payload.language && ['es', 'it', 'en', 'de'].includes(payload.language)) {
        insertPayload.language = payload.language;
      }

      const { data: newConvo, error: insertErr } = await supabase
        .from('conversations')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertErr) throw insertErr;

      await logAuditEvent({
        tenant_id: payload.tenant_id,
        action: 'create_incident',
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
        message: "Conversation created",
        conversation_id: newConvo.id,
        action: "created"
      });
    }

  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
  }
}
