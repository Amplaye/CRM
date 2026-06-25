import { NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import {
  storeMetaConnection,
  upsertSetupStatus,
  readSetupView,
  type SetupStatus,
} from "@/lib/whatsapp/connection";

// Concierge fallback for when self-service Embedded Signup can't complete — e.g.
// the WABA is still a test account, the business isn't verified yet, or there's a
// payment-method block (exactly the BALI Rest pilot situation). A BALI Flow
// platform admin pastes the identifiers + token Meta gives them and we wire the
// tenant the same way the automated flow would, OR just nudges the status when
// they're helping the owner over chat.
//
// Two actions:
//   • connect { tenant_id, access_token, phone_number_id, waba_id?, business_id? }
//       → persist a working connection by hand (token → tenants.secrets etc.).
//   • status  { tenant_id, setup_status, notes? }
//       → set the onboarding status (e.g. mark live / failed_needs_manual_help).
//
// Platform-admin only (assertPlatformAdmin).
const STATUSES: SetupStatus[] = [
  "not_started",
  "waiting_for_meta_login",
  "embedded_signup_started",
  "meta_connected",
  "phone_connected",
  "webhook_verified",
  "templates_pending",
  "templates_submitted",
  "templates_approved",
  "test_message_ready",
  "test_message_sent",
  "live",
  "failed_needs_manual_help",
];

export async function POST(req: Request) {
  const admin = await assertPlatformAdmin();
  if (!admin.ok) return admin.res;

  let body: {
    tenant_id?: string;
    action?: string;
    access_token?: string;
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
    setup_status?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId = body?.tenant_id;
  const action = body?.action;
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });

  if (action === "status") {
    const status = body.setup_status as SetupStatus | undefined;
    if (!status || !STATUSES.includes(status)) {
      return NextResponse.json({ error: "invalid_setup_status" }, { status: 400 });
    }
    const res = await upsertSetupStatus(tenantId, {
      setupStatus: status,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    if (!res.ok) return NextResponse.json({ error: res.error || "save_failed" }, { status: 500 });
    return NextResponse.json({ ok: true, ...(await readSetupView(tenantId)) });
  }

  if (action === "connect") {
    const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
    const phoneNumberId = typeof body.phone_number_id === "string" ? body.phone_number_id.trim() : "";
    if (!accessToken) return NextResponse.json({ error: "access_token_required" }, { status: 400 });
    if (!phoneNumberId) return NextResponse.json({ error: "phone_number_id_required" }, { status: 400 });

    const stored = await storeMetaConnection({
      tenantId,
      businessId: body.business_id?.trim() || null,
      wabaId: body.waba_id?.trim() || null,
      phoneNumberId,
      accessToken,
      connectionStatus: "connected",
    });
    if (!stored.ok) return NextResponse.json({ error: stored.error || "store_failed" }, { status: 500 });

    await upsertSetupStatus(tenantId, {
      setupStatus: "phone_connected",
      notes: "Connected manually by platform admin",
      lastError: null,
    });
    return NextResponse.json({ ok: true, ...(await readSetupView(tenantId)) });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
