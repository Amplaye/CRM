import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { handleMetaWebhookVerification, verifyMetaSignature } from "@/lib/meta-signature";

// Meta-NATIVE WhatsApp webhook receiver — the single app-level URL you register in
// the Meta App dashboard (and the one /api/whatsapp/embedded-signup subscribes each
// tenant WABA to). Meta delivers ALL tenants' events here, keyed by phone_number_id.
//
// Scope (deliberately minimal): this route makes the per-tenant connection
// OBSERVABLE and proves the webhook is wired. It
//   1. verifies the X-Hub-Signature-256 (shared app secret),
//   2. resolves phone_number_id → tenant via meta_whatsapp_connections,
//   3. records the raw event in webhook_events (the existing audit table),
//   4. flips the tenant's connection to "live" the first time a real event lands.
//
// It does NOT run the AI conversation here: inbound-message → guest/conversation
// ingestion is owned by the n8n flow + /api/webhooks/incoming-message, unchanged.
// Keeping those concerns apart is why we don't duplicate that logic in this route.
export async function GET(request: Request) {
  const verification = handleMetaWebhookVerification(request);
  if (verification) return verification;
  return NextResponse.json({ ok: true });
}

interface MetaChangeValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: Array<{ id?: string }>;
  statuses?: Array<{ id?: string }>;
}

export async function POST(request: Request) {
  // Read the raw body ONCE: we need it both for signature verification and for
  // parsing (calling request.text()/json() twice throws).
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(raw, signature)) {
    return new Response("forbidden", { status: 403 });
  }

  let payload: { object?: string; entry?: Array<{ id?: string; changes?: Array<{ value?: MetaChangeValue; field?: string }> }> };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  // Always 200 to Meta once the signature is valid: a non-2xx makes Meta retry and
  // eventually disable the webhook. We swallow per-tenant processing errors below.
  try {
    const supabase = createServiceRoleClient();

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        // Resolve which tenant owns this number.
        const { data: conn } = await supabase
          .from("meta_whatsapp_connections")
          .select("tenant_id, connection_status")
          .eq("phone_number_id", phoneNumberId)
          .maybeSingle();
        if (!conn?.tenant_id) continue;

        // A stable id for dedup: the first message/status id in the change, else
        // a composite of the WABA entry + field (webhook_events needs it NOT NULL).
        const eventId =
          value.messages?.[0]?.id ||
          value.statuses?.[0]?.id ||
          `${entry.id || phoneNumberId}:${change.field || "event"}`;

        await supabase
          .from("webhook_events")
          .insert({
            tenant_id: String(conn.tenant_id),
            idempotency_key: eventId,
            type: `meta_whatsapp.${change.field || "event"}`,
            payload: change as unknown as Record<string, unknown>,
            status: "success",
          })
          .then(undefined, () => {}); // ignore duplicate-key / transient insert errors

        // First real event proves the webhook is live end to end.
        if (conn.connection_status !== "connected") {
          await supabase
            .from("meta_whatsapp_connections")
            .update({ connection_status: "connected", updated_at: new Date().toISOString() })
            .eq("tenant_id", conn.tenant_id);
        }
        await supabase
          .from("whatsapp_setups")
          .update({ setup_status: "webhook_verified", updated_at: new Date().toISOString() })
          .eq("tenant_id", conn.tenant_id)
          .in("setup_status", ["meta_connected", "phone_connected"]);
      }
    }
  } catch (e) {
    console.error("meta/whatsapp webhook processing error:", e);
  }

  return NextResponse.json({ ok: true });
}
