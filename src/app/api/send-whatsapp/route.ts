import { NextRequest, NextResponse } from "next/server";
import { logSystemEvent, resolveSystemEvents } from "@/lib/system-log";
import { assertAiSecret } from "@/lib/ai-auth";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { resolveWhatsAppFrom, tenantWhatsAppFrom } from "@/lib/whatsapp/from";

export async function POST(req: NextRequest) {
  // Accept either: (a) valid x-ai-secret (n8n/Vapi) or (b) a signed-in dashboard session.
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
    const { to, message, tenant_id } = await req.json();

    if (!to || !message) {
      return NextResponse.json({ error: "Missing 'to' or 'message'" }, { status: 400 });
    }

    const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;

    if (!TWILIO_SID || !TWILIO_TOKEN) {
      return NextResponse.json({ error: "Twilio credentials not configured" }, { status: 500 });
    }

    // Send FROM the tenant's own number when the caller names a tenant; otherwise
    // the platform default. One source of truth (resolveWhatsAppFrom) — no number
    // hardcoded here. Today every tenant resolves to the same sandbox/env number,
    // so this is byte-identical until a customer sets settings.whatsapp.from.
    let tenantFrom: string | undefined;
    if (tenant_id) {
      const { data: tenantRow } = await createServiceRoleClient()
        .from("tenants")
        .select("settings")
        .eq("id", tenant_id)
        .maybeSingle();
      tenantFrom = tenantWhatsAppFrom(tenantRow?.settings);
    }
    const TWILIO_FROM = resolveWhatsAppFrom(tenantFrom);

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

    const normalizedTo = to.replace(/^whatsapp:/, "").trim();
    const errorKey = `twilio:whatsapp:${normalizedTo}`;

    if (!res.ok) {
      logSystemEvent({
        category: "message_failure",
        severity: "high",
        title: `WhatsApp send failed to ${to}`,
        description: data.message || "Twilio error",
        metadata: { to, twilioError: data },
        error_key: errorKey,
      });
      return NextResponse.json({ error: data.message || "Twilio error", details: data }, { status: res.status });
    }

    // Recovery: questa chiamata Twilio ha funzionato → chiudi gli open per stesso destinatario
    // e per "twilio service down" globale.
    void resolveSystemEvents({ error_key: errorKey });
    void resolveSystemEvents({ error_key: "twilio:service" });

    return NextResponse.json({ success: true, sid: data.sid });
  } catch (err: any) {
    logSystemEvent({
      category: "message_failure",
      severity: "critical",
      title: "WhatsApp send crashed",
      description: err.message,
      error_key: "twilio:service",
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
