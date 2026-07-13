import { NextRequest, NextResponse, after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildTenantCallConfig } from "@/lib/voice/engine";
import { sendWhatsAppTemplate, toMetaRecipient } from "@/lib/whatsapp/meta";
import { getCreditBalance, consumeCredits } from "@/lib/billing/credits";
import { mcFor } from "@/lib/billing/credits-catalog";

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

  // The number the caller dialled (tenant's line), across Vapi payload shapes.
  // Hoisted above the type switch: the end-of-call report resolves its tenant the
  // same way as an assistant-request does.
  const dialled: string =
    msg?.call?.phoneNumber?.number ||
    msg?.phoneNumber?.number ||
    msg?.call?.phoneNumberId ||
    msg?.call?.assistantOverrides?.metadata?.dialled ||
    "";

  // A finished call → bill its minutes. This event used to be dropped on the
  // floor with every other non-assistant-request, which is precisely why voice
  // was our least-controlled cost: nothing in the system knew a call had happened,
  // let alone how long it ran. It carries the real duration and Vapi's real
  // charge, so it's the only honest place to meter voice.
  //
  // Post-hoc by nature: the call is already over and already paid for. There is
  // nothing to gate here — the gate that MATTERS is on assistant-request below,
  // which refuses to answer the phone at all when the wallet is empty.
  if (msg.type === "end-of-call-report" || msg.type === "end-of-call") {
    await meterCall(msg, dialled);
    return NextResponse.json({}, { status: 200 });
  }

  if (msg.type && msg.type !== "assistant-request") {
    // Not an assistant-request (e.g. status-update); ack and ignore.
    return NextResponse.json({}, { status: 200 });
  }

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

    // Credit gate: refuse to ANSWER when the wallet can't cover a minute. Voice
    // is the one action we can't stop halfway — once the assistant picks up, the
    // minutes run and Vapi bills us for all of them. So the decision has to
    // happen here, at the only moment we still control.
    //
    // A caller must never hear silence: returning `{ error }` with a 200 is Vapi's
    // documented way to decline a call (same shape as the unknown-number branch
    // above), and Vapi then plays its own failure message rather than connecting.
    const balance = await getCreditBalance(tenantId, supabase).catch(() => null);
    if (balance && balance.totalRemainingMc < mcFor("voice_minute")) {
      console.error(`[voice] tenant ${tenantId} out of credits — declining call`);
      return NextResponse.json({ error: "credits_exhausted" }, { status: 200 });
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
          const r = await sendWhatsAppTemplate(recipient, "missed_call_notice", cfg.lang, [cfg.restaurantName]);
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

/**
 * Bill a finished call. Vapi's end-of-call report carries `durationSeconds` and
 * `cost` (what Vapi charged US, in USD) — we debit the tenant per started minute
 * and record our real cost alongside it, so the voice margin is visible per call
 * instead of assumed per plan.
 *
 * Never throws: this runs on a webhook Vapi will retry, and a metering failure
 * must not make us look broken to the provider.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function meterCall(msg: any, dialled: string): Promise<void> {
  try {
    const seconds = Number(
      msg?.durationSeconds ?? msg?.call?.durationSeconds ?? msg?.artifact?.durationSeconds ?? 0,
    );
    if (!Number.isFinite(seconds) || seconds <= 0) return;

    if (!dialled) return;
    const supabase = createServiceRoleClient();
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id")
      .eq("settings->vapi->>phoneNumber", dialled)
      .limit(1);
    const tenantId = tenants?.[0]?.id;
    if (!tenantId) {
      console.error(`[voice] end-of-call for unknown number ${dialled} — not metered`);
      return;
    }

    // Per STARTED minute: a 20-second call still costs us a minute's worth of
    // model+STT+TTS spin-up, and mcFor() rounds the quantity up.
    const minutes = seconds / 60;
    const cost = Number(msg?.cost);

    await consumeCredits(tenantId, "voice_minute", {
      qty: minutes,
      costEur: Number.isFinite(cost) ? cost : undefined,
      metadata: {
        call_id: msg?.call?.id || null,
        duration_seconds: seconds,
        ended_reason: msg?.endedReason || null,
      },
    });
  } catch (e) {
    console.error("[voice] meterCall failed", e);
  }
}
