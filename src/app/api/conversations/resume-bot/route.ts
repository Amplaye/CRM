import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api-error";
import { CLOUDFLARE_ENGINE_BASE_URL } from "@/lib/tenants/engine-health";

// The bot now lives in the Cloudflare Worker (bot-engine), not n8n. Re-triggering
// the WhatsApp flow after a manual owner takeover is done via the Worker's
// internal endpoint (auth: CRON_SECRET, shared CRM↔Worker), which re-enqueues the
// last user message on the tenant's ConversationAgent — same effect the old
// `${slug}-whatsapp` n8n webhook had, minus the slug guesswork (the endpoint takes
// the tenant_id directly).
const RETRIGGER_URL = `${CLOUDFLARE_ENGINE_BASE_URL}/internal/retrigger`;

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
      .select("id, name, phone, tenant_id")
      .eq("id", guest_id)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!guest) return NextResponse.json({ error: "guest not found" }, { status: 404 });

    // Clear both the timestamp and the manual hold (set by owner-echo for the
    // Coexistence takeover). Without clearing bot_paused_hold the engine would
    // stay silent forever after a hold takeover.
    const { error: uErr } = await supabase
      .from("guests")
      .update({ bot_paused_at: null, bot_paused_hold: false })
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

    // Re-trigger via the bot-engine Worker: it re-enqueues the last user message
    // on this tenant's ConversationAgent (tenant_id passed directly — no slug to
    // derive, no other tenant's bot to poke by mistake). Requires CRON_SECRET,
    // shared CRM↔Worker; without it we skip the re-trigger (the unpause already
    // happened) rather than call the endpoint unauthenticated.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ success: true, retriggered: false, reason: "CRON_SECRET not configured" });
    }
    const phoneE164 = guest.phone.startsWith("+") ? guest.phone : "+" + guest.phone.replace(/\D/g, "");

    const res = await fetch(RETRIGGER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": cronSecret },
      body: JSON.stringify({
        tenant_id: guest.tenant_id,
        phone: phoneE164,
        text: lastUserMessage,
        profile_name: guest.name || "",
      }),
    });
    return NextResponse.json({ success: true, retriggered: res.ok });
  } catch (e: any) {
    return apiError(e, { route: "conversations/resume-bot", publicMessage: "operation_failed", status: 500 });
  }
}
