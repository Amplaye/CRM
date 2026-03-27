import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
type WebhookStatus = "processing" | "success" | "failed";
import { createReservationAction, updateReservationDetailsAction } from "@/app/actions/reservations";

/**
 * Main ingestion gateway for AI Agents (Bland AI, WhatsApp NLP, etc).
 * Protects against duplicates via idempotency keys.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
    }

    // For demo/prototype purposes, the Bearer token ACTS as the Tenant ID.
    // In production, you would lookup the API Key in a `tenant_api_keys` table to get the actual tenant_id.
    const apiKey = authHeader.split("Bearer ")[1];
    const tenantId = apiKey;

    const body = await req.json();
    const { idempotency_key, type, payload, handoff_to_human } = body;

    if (!idempotency_key || !type || !payload) {
      return NextResponse.json({ error: "Missing required fields: idempotency_key, type, payload" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // 1. Idempotency Check
    const { data: existingEvents } = await supabase
      .from("webhook_events")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotency_key)
      .limit(1);

    if (existingEvents && existingEvents.length > 0) {
      // We already processed this, gracefully return 200 to satisfy exact-once delivery retries
      return NextResponse.json({ status: "already_processed", event_id: existingEvents[0].id }, { status: 200 });
    }

    // Prepare Webhook Audit Envelope
    let finalStatus: WebhookStatus = "processing";
    let errorLog: string | undefined = undefined;

    // Save initial processing envelope to ensure it exists even if container dies
    const { data: webhookEvent, error: insertErr } = await supabase
      .from("webhook_events")
      .insert({
        tenant_id: tenantId,
        idempotency_key,
        type,
        payload,
        status: finalStatus,
        handoff_to_human: !!handoff_to_human,
        created_at: new Date().toISOString()
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;
    const webhookEventId = webhookEvent.id;

    // 2. Dispatch the exact operation securely mapping through internal Admin Actions
    try {
      switch (type) {
        case "reservation.create":
           const createRes = await createReservationAction({
             adminTenantId: tenantId,
             tenantId: tenantId,
             guestName: payload.guest_name,
             guestPhone: payload.guest_phone,
             date: payload.date,
             time: payload.time,
             partySize: payload.party_size,
             source: "ai_agent",
             notes: payload.notes
           });
           if (!createRes.success) throw new Error((createRes as any).error);
           break;

        case "reservation.cancel":
           // Payload must include reservationId
           const cancelRes = await updateReservationDetailsAction({
              adminTenantId: tenantId,
              tenantId: tenantId,
              reservationId: payload.reservation_id,
              data: { status: "cancelled" }
           });
           if (!cancelRes.success) throw new Error((cancelRes as any).error);
           break;

        case "chat.ingest":
        case "voice.ingest":
           // Append transcript entry to the conversation
           // Supabase: use array_append via RPC or fetch-then-update
           const { data: convo, error: convoFetchErr } = await supabase
             .from("conversations")
             .select("transcript")
             .eq("id", payload.conversation_id)
             .single();

           if (convoFetchErr) throw convoFetchErr;

           const updatedTranscript = [
             ...(convo.transcript || []),
             {
               role: payload.source_role || "ai",
               content: payload.message,
               timestamp: new Date().toISOString()
             }
           ];

           const { error: convoUpdateErr } = await supabase
             .from("conversations")
             .update({
               transcript: updatedTranscript,
               updated_at: new Date().toISOString()
             })
             .eq("id", payload.conversation_id);

           if (convoUpdateErr) throw convoUpdateErr;
           break;

        default:
           throw new Error(`Unsupported webhook type: ${type}`);
      }

      finalStatus = "success";
    } catch (dispatchError: any) {
      finalStatus = "failed";
      errorLog = dispatchError.message;
    }

    // 3. Close the audit trail
    await supabase
      .from("webhook_events")
      .update({
        status: finalStatus,
        error_log: errorLog || null,
      })
      .eq("id", webhookEventId);

    if (finalStatus === "failed") {
       return NextResponse.json({ error: errorLog }, { status: 400 });
    }

    return NextResponse.json({ success: true, event_id: webhookEventId }, { status: 200 });
  } catch (globalError: any) {
    return NextResponse.json({ error: "Internal webhook handler crash", details: globalError.message }, { status: 500 });
  }
}
