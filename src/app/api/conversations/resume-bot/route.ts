import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const PICNIC_WEBHOOK = "https://n8n.srv1468837.hstgr.cloud/webhook/picnic-whatsapp";

// Clears the bot_paused_at flag for a guest, then optionally re-triggers the
// WhatsApp bot with the latest user message so it can pick up the booking
// flow where it left off (asks for next missing field).
export async function POST(request: Request) {
  try {
    const { guest_id, retrigger = true } = await request.json();
    if (!guest_id) {
      return NextResponse.json({ error: "guest_id required" }, { status: 400 });
    }
    const supabase = await createServerSupabaseClient();

    const { data: guest, error: gErr } = await supabase
      .from("guests")
      .select("id, name, phone")
      .eq("id", guest_id)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!guest) return NextResponse.json({ error: "guest not found" }, { status: 404 });

    const { error: uErr } = await supabase
      .from("guests")
      .update({ bot_paused_at: null })
      .eq("id", guest_id);
    if (uErr) throw uErr;

    if (!retrigger || !guest.phone) {
      return NextResponse.json({ success: true, retriggered: false });
    }

    const { data: convs } = await supabase
      .from("conversations")
      .select("transcript")
      .eq("guest_id", guest_id)
      .order("updated_at", { ascending: false })
      .limit(1);
    let lastUserMessage = "";
    const tx = (convs?.[0]?.transcript || []) as Array<{ role: string; content: string }>;
    for (let i = tx.length - 1; i >= 0; i--) {
      if (tx[i]?.role === "user") { lastUserMessage = tx[i].content || ""; break; }
    }
    if (!lastUserMessage) {
      return NextResponse.json({ success: true, retriggered: false, reason: "no last user message" });
    }

    const phoneE164 = guest.phone.startsWith("+") ? guest.phone : "+" + guest.phone.replace(/\D/g, "");
    const form = new URLSearchParams();
    form.set("From", "whatsapp:" + phoneE164);
    form.set("Body", lastUserMessage);
    form.set("ProfileName", guest.name || "");

    const res = await fetch(PICNIC_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return NextResponse.json({ success: true, retriggered: res.ok });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
