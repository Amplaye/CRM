import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendWhatsAppMeta } from "@/lib/whatsapp/meta";

export async function POST(req: NextRequest) {
  try {
    const { conversation_id, body } = await req.json();
    if (!conversation_id || !body || typeof body !== "string") {
      return NextResponse.json({ error: "Missing conversation_id or body" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Look up the recipient phone
    const { data: convo, error: convoErr } = await supabase
      .from("bali_conversations")
      .select("guest_phone, human_takeover")
      .eq("id", conversation_id)
      .single();

    if (convoErr || !convo) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Send via Meta Cloud API from the shared platform number (resolved inside
    // sendWhatsAppMeta). No number hardcoded here — the old BALI live-number
    // fallback is gone; a tenant's own number is config (settings.whatsapp.from).
    const result = await sendWhatsAppMeta(convo.guest_phone, body);

    if (!result.ok) {
      return NextResponse.json({ error: `Meta: ${result.errorMessage}` }, { status: result.status || 502 });
    }

    // Save the human reply to the bali_messages table
    await supabase.from("bali_messages").insert({
      conversation_id,
      direction: "outbound",
      sender: "human",
      body,
    });

    // Sending manually implies the human is taking over (or is already in control)
    await supabase
      .from("bali_conversations")
      .update({
        human_takeover: true,
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 200),
        last_message_direction: "outbound",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation_id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
