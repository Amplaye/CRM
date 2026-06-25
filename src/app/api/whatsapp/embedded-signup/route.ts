import { NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import {
  exchangeCodeForToken,
  subscribeAppToWaba,
  fetchWabaInfo,
} from "@/lib/whatsapp/embedded-signup";
import { storeMetaConnection, upsertSetupStatus } from "@/lib/whatsapp/connection";
import { logSystemEvent } from "@/lib/system-log";

// Server side of Meta Embedded Signup. The browser runs FB.login({ config_id })
// and hands us back a short-lived authorization `code` plus the `waba_id` /
// `phone_number_id` it learned from the embedded-signup message event. We:
//   1. exchange the code for a business access token (server-side, app secret),
//   2. subscribe the BALI Flow app to that WABA's webhooks,
//   3. read owner_business_info + confirm the phone number,
//   4. persist the token (tenants.secrets) + identifiers (meta_whatsapp_connections),
//      which ALSO wires settings.whatsapp.from so the tenant sends from its number.
//
// The token NEVER round-trips to the browser. User-authed + ownership-checked.
//
// Body: { tenant_id, code, waba_id?, phone_number_id? }
export async function POST(req: Request) {
  let body: { tenant_id?: string; code?: string; waba_id?: string; phone_number_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId = body?.tenant_id;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "code_required" }, { status: 400 });

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  // Record that we got past Meta login before we start the (slower) Graph calls,
  // so a failure here leaves a useful "embedded_signup_started" trail.
  await upsertSetupStatus(tenantId, { setupStatus: "embedded_signup_started", lastError: null });

  // 1) Code → business access token.
  const tok = await exchangeCodeForToken(code);
  if (!tok.ok || !tok.accessToken) {
    await fail(tenantId, tok.error || "token_exchange_failed");
    return NextResponse.json({ error: tok.error || "token_exchange_failed" }, { status: 502 });
  }
  const token = tok.accessToken;

  // 2) Resolve the WABA + phone number. Prefer the ids the client passed (from the
  //    embedded-signup event); fall back to / confirm from the Graph API.
  let wabaId = typeof body?.waba_id === "string" ? body.waba_id.trim() : "";
  let phoneNumberId = typeof body?.phone_number_id === "string" ? body.phone_number_id.trim() : "";
  let businessId: string | undefined;
  let displayPhone: string | undefined;

  if (wabaId) {
    const info = await fetchWabaInfo(wabaId, token);
    if (info.ok) {
      businessId = info.businessId;
      if (!phoneNumberId && info.phoneNumberId) phoneNumberId = info.phoneNumberId;
      displayPhone = info.displayPhoneNumber;
    }
    // 3) Subscribe our app to the WABA's webhooks (best-effort: a failure here
    //    doesn't block storing the connection, but we surface it as last_error).
    const sub = await subscribeAppToWaba(wabaId, token);
    if (!sub.ok) {
      await logSystemEvent({
        tenant_id: tenantId,
        severity: "medium",
        category: "webhook_failure",
        title: "WABA webhook subscribe failed",
        description: sub.error || "subscribed_apps returned an error",
      }).catch(() => {});
    }
  }

  // 4) Persist everything (token → tenants.secrets, identifiers → connection +
  //    settings.whatsapp.from). connection_status reflects whether we have a number.
  const stored = await storeMetaConnection({
    tenantId,
    businessId,
    wabaId: wabaId || null,
    phoneNumberId: phoneNumberId || null,
    accessToken: token,
    tokenType: tok.tokenType ?? null,
    expiresIn: tok.expiresIn ?? null,
    connectionStatus: phoneNumberId ? "connected" : "pending",
  });
  if (!stored.ok) {
    await fail(tenantId, stored.error || "store_failed");
    return NextResponse.json({ error: stored.error || "store_failed" }, { status: 500 });
  }

  await upsertSetupStatus(tenantId, {
    setupStatus: phoneNumberId ? "phone_connected" : "meta_connected",
    lastError: null,
  });

  return NextResponse.json({
    ok: true,
    connection: {
      meta_business_id: businessId ?? null,
      waba_id: wabaId || null,
      phone_number_id: phoneNumberId || null,
      display_phone_number: displayPhone ?? null,
      connection_status: phoneNumberId ? "connected" : "pending",
    },
  });
}

async function fail(tenantId: string, error: string) {
  await upsertSetupStatus(tenantId, { setupStatus: "failed_needs_manual_help", lastError: error });
  await logSystemEvent({
    tenant_id: tenantId,
    severity: "high",
    category: "message_failure",
    title: "Embedded Signup failed",
    description: error,
  }).catch(() => {});
}
