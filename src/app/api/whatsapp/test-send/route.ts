import { NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import { sendWhatsAppMeta } from "@/lib/whatsapp/meta";
import { upsertSetupStatus } from "@/lib/whatsapp/connection";

// Settings → WhatsApp: "send me a test message". Proves the connection end to end
// using the tenant's OWN credentials (token + phone_number_id from tenants.secrets,
// set by /api/whatsapp/embedded-signup) — not the platform's shared number.
//
// NOTE: free-text (type:"text") only works INSIDE the 24h customer-service window.
// A brand-new number the owner has never messaged from is outside it, so this test
// is meant to be sent to a number that has just messaged the business (the owner's
// own phone, after they say "hi" to it). If Meta rejects with a re-engagement
// error we surface it verbatim so the UI can explain the 24h rule.
//
// Body: { tenant_id, to }
export async function POST(req: Request) {
  let body: { tenant_id?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId = body?.tenant_id;
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  if (!to) return NextResponse.json({ error: "recipient_required" }, { status: 400 });

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }
  const svc = auth.svc;

  // Read the tenant's own Meta credentials. Without them we cannot test — the
  // platform default would send from the WRONG number and prove nothing.
  const { data: tenant } = await svc.from("tenants").select("secrets").eq("id", tenantId).maybeSingle();
  const secrets = (tenant?.secrets as Record<string, unknown> | null) || {};
  const token = typeof secrets.meta_access_token === "string" ? secrets.meta_access_token : undefined;
  const fromId = typeof secrets.meta_phone_number_id === "string" ? secrets.meta_phone_number_id : undefined;
  if (!token || !fromId) {
    return NextResponse.json({ error: "not_connected" }, { status: 400 });
  }

  const result = await sendWhatsAppMeta(
    to,
    "✅ BALI Flow è connesso. Questo è un messaggio di prova dal tuo numero WhatsApp.",
    fromId,
    token,
  );

  if (result.ok) {
    await upsertSetupStatus(tenantId, { setupStatus: "test_message_sent", lastError: null });
    return NextResponse.json({ ok: true, message_id: result.messageId });
  }

  await upsertSetupStatus(tenantId, { lastError: result.errorMessage || "test_send_failed" });
  return NextResponse.json(
    { ok: false, error: result.errorMessage || "test_send_failed", status: result.status },
    { status: 502 },
  );
}
