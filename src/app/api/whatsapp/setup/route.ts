import { NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import {
  readSetupView,
  upsertSetupStatus,
  type PhoneNumberUsage,
  type SetupStatus,
} from "@/lib/whatsapp/connection";

// Settings → WhatsApp onboarding state machine.
//   GET  ?tenant_id=...   → { setup, connection } (no secret) for the UI.
//   POST { tenant_id, phone_number_usage?, setup_status?, notes? }
//        → record the owner's answers / advance the pipeline status.
//
// User-authenticated (cookie) + ownership-checked, exactly like /api/pos/connect.
// The actual Meta connection (token exchange) lives in /api/whatsapp/embedded-signup;
// this route only carries the non-secret onboarding STATE that drives the wizard UI
// and the admin status card.

const USAGES: PhoneNumberUsage[] = ["business_app", "normal_whatsapp", "new_number", "unknown"];
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

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  const view = await readSetupView(tenantId);
  return NextResponse.json({ ok: true, ...view });
}

export async function POST(req: Request) {
  let body: { tenant_id?: string; phone_number_usage?: string; setup_status?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId = body?.tenant_id;
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  const usage = body.phone_number_usage as PhoneNumberUsage | undefined;
  const status = body.setup_status as SetupStatus | undefined;
  if (usage !== undefined && !USAGES.includes(usage)) {
    return NextResponse.json({ error: "invalid_phone_number_usage" }, { status: 400 });
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid_setup_status" }, { status: 400 });
  }

  const res = await upsertSetupStatus(tenantId, {
    phoneNumberUsage: usage,
    setupStatus: status,
    notes: typeof body.notes === "string" ? body.notes : undefined,
  });
  if (!res.ok) return NextResponse.json({ error: res.error || "save_failed" }, { status: 500 });

  const view = await readSetupView(tenantId);
  return NextResponse.json({ ok: true, ...view });
}
