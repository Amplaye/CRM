import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { WebhookEvent } from "@/lib/types";
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
    // In production, you would lookup the API Key in a `tenant_api_keys` collection to get the actual tenant_id.
    const apiKey = authHeader.split("Bearer ")[1];
    const tenantId = apiKey;

    const body = await req.json();
    const { idempotency_key, type, payload, handoff_to_human } = body;

    if (!idempotency_key || !type || !payload) {
      return NextResponse.json({ error: "Missing required fields: idempotency_key, type, payload" }, { status: 400 });
    }

    // 1. Idempotency Check
    const eventsQuery = await db.collection("webhook_events")
      .where("tenant_id", "==", tenantId)
      .where("idempotency_key", "==", idempotency_key)
      .limit(1)
      .get();

    if (!eventsQuery.empty) {
      // We already processed this, gracefully return 200 to satisfy exact-once delivery retries
      return NextResponse.json({ status: "already_processed", event_id: eventsQuery.docs[0].id }, { status: 200 });
    }

    // Prepare Webhook Audit Envelope
    const webhookEventRef = db.collection("webhook_events").doc();
    let finalStatus: WebhookEvent["status"] = "processing";
    let errorLog: string | undefined = undefined;

    // Save initial processing envelope to ensure it exists even if container dies
    await webhookEventRef.set({
      tenant_id: tenantId,
      idempotency_key,
      type,
      payload,
      status: finalStatus,
      handoff_to_human: !!handoff_to_human,
      created_at: Date.now()
    });

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
           // Simulating finding the active conversation and appending transcript
           // This represents where WhatsApp/Bland AI push the conversation history chunk
           const convoRef = db.collection("conversations").doc(payload.conversation_id);
           await convoRef.update({
             transcript: require("firebase-admin").firestore.FieldValue.arrayUnion({
                role: payload.source_role || "ai",
                content: payload.message,
                timestamp: Date.now()
             }),
             updated_at: Date.now()
           });
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
    await webhookEventRef.update({
      status: finalStatus,
      error_log: errorLog || null, // Firebase doesn't like undefined
    });

    if (finalStatus === "failed") {
       return NextResponse.json({ error: errorLog }, { status: 400 });
    }

    return NextResponse.json({ success: true, event_id: webhookEventRef.id }, { status: 200 });
  } catch (globalError: any) {
    return NextResponse.json({ error: "Internal webhook handler crash", details: globalError.message }, { status: 500 });
  }
}
