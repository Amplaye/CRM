import { NextRequest, NextResponse } from "next/server";
import { logSystemEvent } from "@/lib/system-log";
import { assertAiSecret } from "@/lib/ai-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  // Accept either: (a) valid x-ai-secret (n8n/Retell) or (b) a signed-in dashboard session.
  // This lets /pending and other dashboard pages call this endpoint from the browser
  // (same-origin cookies) without embedding the shared secret in the JS bundle.
  const unauth = assertAiSecret(req);
  if (unauth) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return unauth;
    } catch {
      return unauth;
    }
  }
  try {
    const { to, message } = await req.json();

    if (!to || !message) {
      return NextResponse.json({ error: "Missing 'to' or 'message'" }, { status: 400 });
    }

    const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

    if (!TWILIO_SID || !TWILIO_TOKEN) {
      return NextResponse.json({ error: "Twilio credentials not configured" }, { status: 500 });
    }

    // Format phone number for WhatsApp
    let whatsappTo = to;
    if (!whatsappTo.startsWith("whatsapp:")) {
      if (!whatsappTo.startsWith("+")) whatsappTo = "+" + whatsappTo;
      whatsappTo = "whatsapp:" + whatsappTo;
    }

    const body = new URLSearchParams({
      From: TWILIO_FROM,
      To: whatsappTo,
      Body: message,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
        },
        body: body.toString(),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      logSystemEvent({
        category: "message_failure",
        severity: "high",
        title: `WhatsApp send failed to ${to}`,
        description: data.message || "Twilio error",
        metadata: { to, twilioError: data },
      });
      return NextResponse.json({ error: data.message || "Twilio error", details: data }, { status: res.status });
    }

    return NextResponse.json({ success: true, sid: data.sid });
  } catch (err: any) {
    logSystemEvent({
      category: "message_failure",
      severity: "critical",
      title: "WhatsApp send crashed",
      description: err.message,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
