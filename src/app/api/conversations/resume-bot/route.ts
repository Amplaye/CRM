import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { apiError } from "@/lib/api-error";

// Shared n8n instance host. The per-tenant WhatsApp webhook lives at
// `${N8N_WEBHOOK_BASE}/${slug}-whatsapp` — same naming convention the onboarding
// orchestrator uses when it clones the workflows (picnic-* → {slug}-*).
const N8N_WEBHOOK_BASE = "https://n8n.srv1468837.hstgr.cloud/webhook";

// Tenants have no stored `slug` column; the webhook slug is derived from the
// restaurant name the same way onboarding does (lowercase ASCII, hyphenated).
// e.g. "PICNIC" → "picnic", "Trattoria Rossa" → "trattoria-rossa".
function slugifyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

    // Resolve the guest's own restaurant to build its WhatsApp webhook URL.
    // No Picnic fallback: if the tenant is missing we skip the re-trigger
    // (the unpause above already happened) instead of poking another tenant's bot.
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", guest.tenant_id)
      .maybeSingle();
    const slug = tenant?.name ? slugifyName(tenant.name) : "";
    if (!slug) {
      return NextResponse.json({ success: true, retriggered: false, reason: "tenant slug unavailable" });
    }
    const webhookUrl = `${N8N_WEBHOOK_BASE}/${slug}-whatsapp`;

    const phoneE164 = guest.phone.startsWith("+") ? guest.phone : "+" + guest.phone.replace(/\D/g, "");
    const form = new URLSearchParams();
    form.set("From", "whatsapp:" + phoneE164);
    form.set("Body", lastUserMessage);
    form.set("ProfileName", guest.name || "");

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return NextResponse.json({ success: true, retriggered: res.ok });
  } catch (e: any) {
    return apiError(e, { route: "conversations/resume-bot", publicMessage: "operation_failed", status: 500 });
  }
}
