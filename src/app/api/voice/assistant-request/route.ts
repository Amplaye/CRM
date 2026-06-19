import { NextRequest, NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildTenantCallConfig } from "@/lib/voice/engine";
import { sendWhatsAppTemplate, toMetaRecipient } from "@/lib/whatsapp/meta";

// Inbound phone voice engine endpoint (Vapi "assistant-request" server event).
// A phone number points its server.url here; on an incoming call Vapi POSTs the
// event and we return the assistant config to use. We resolve the tenant from
// the DIALED number (settings.vapi.phoneNumber), compose its prompt fresh from
// the single source of truth, and return the shared engine assistant id with
// per-tenant assistantOverrides — same engine, same composer as the web path.

export async function POST(req: NextRequest) {
  const secret = process.env.VAPI_SERVER_SECRET;
  if (secret && req.headers.get("x-vapi-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const msg = body?.message || {};
  if (msg.type && msg.type !== "assistant-request") {
    // Not an assistant-request (e.g. status-update/end-of-call); ack and ignore.
    return NextResponse.json({}, { status: 200 });
  }

  // The number the caller dialled (tenant's line), across Vapi payload shapes.
  const dialled: string =
    msg?.call?.phoneNumber?.number ||
    msg?.phoneNumber?.number ||
    msg?.call?.phoneNumberId ||
    msg?.call?.assistantOverrides?.metadata?.dialled ||
    "";

  // The number the customer is calling FROM, across Vapi payload shapes. Used to
  // pick the GREETING language from the caller's country prefix (a +49 tourist
  // calling an Italian venue is greeted in German); the conversation then follows
  // whatever language they actually speak (the transcriber is multilingual).
  const callerNumber: string =
    msg?.call?.customer?.number || msg?.customer?.number || "";

  try {
    const supabase = createServiceRoleClient();
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id")
      .eq("settings->vapi->>phoneNumber", dialled)
      .limit(1);
    const tenantId = tenants?.[0]?.id;
    if (!tenantId) {
      return NextResponse.json(
        { error: `No restaurant is configured for the number ${dialled}.` },
        { status: 200 },
      );
    }

    // Date header vars are derived from the tenant's own tz/locale in the engine
    // (same source as the web path). The caller's number picks the greeting
    // language from its country prefix (falls back to the venue's locale).
    const cfg = await buildTenantCallConfig(tenantId, {}, new Date(), callerNumber);

    // When the voicemail/segreteria answered, its script TELLS the caller we've
    // just sent them a WhatsApp ("continue there"). Make that promise true: fire
    // the approved call_followup template to their number AFTER we respond to
    // Vapi (after() → zero added latency on call start). The caller has no open
    // 24h window (they called, didn't message), so it MUST be a template;
    // replying to it opens the window and the normal WhatsApp agent takes over.
    if (cfg.voicemailState === "active") {
      const recipient = toMetaRecipient(callerNumber);
      const isRealNumber = recipient.length >= 10 && !/^0+$/.test(recipient);
      if (isRealNumber) {
        after(async () => {
          const r = await sendWhatsAppTemplate(recipient, "call_followup", cfg.lang, [cfg.restaurantName]);
          if (!r.ok) {
            // Template may still be in Meta review, or the number is unreachable.
            console.error(`[voicemail] call_followup WhatsApp to ${recipient} failed: ${r.errorMessage}`);
          }
        });
      }
    }

    return NextResponse.json(
      { assistantId: cfg.assistantId, assistantOverrides: cfg.assistantOverrides },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 200 });
  }
}
