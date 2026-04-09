import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

const TWILIO_FROM = process.env.BALI_WHATSAPP_FROM || "whatsapp:+34641459479";

export async function POST(req: NextRequest) {
  try {
    const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    if (!TWILIO_SID || !TWILIO_TOKEN) {
      return NextResponse.json(
        { error: "Twilio credentials not configured" },
        { status: 500 }
      );
    }

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

    const to = convo.guest_phone.startsWith("+")
      ? "whatsapp:" + convo.guest_phone
      : "whatsapp:+" + convo.guest_phone;

    // Send via Twilio
    const twilioBody = new URLSearchParams({
      From: TWILIO_FROM,
      To: to,
      Body: body,
    }).toString();

    const auth = "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: auth,
        },
        body: twilioBody,
      }
    );

    if (!twilioRes.ok) {
      const errText = await twilioRes.text();
      return NextResponse.json({ error: `Twilio: ${errText}` }, { status: 502 });
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
