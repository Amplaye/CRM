import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildTenantCallConfig, spelledDateVars } from "@/lib/voice/engine";

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

    // Inbound phone: Vapi can fill {{current_date}} etc itself, but we compute
    // them here too so the source is identical to the web path. Timezone/locale
    // come from the composed tenant inside buildTenantCallConfig's prompt; for
    // the header vars we let buildTenantCallConfig stamp defaults.
    const cfg = await buildTenantCallConfig(tenantId, spelledDateVars(new Date()));
    return NextResponse.json(
      { assistantId: cfg.assistantId, assistantOverrides: cfg.assistantOverrides },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 200 });
  }
}
