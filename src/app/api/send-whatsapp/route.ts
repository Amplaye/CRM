import { NextRequest, NextResponse } from "next/server";
import { logSystemEvent, resolveSystemEvents } from "@/lib/system-log";
import { assertAiSecret } from "@/lib/ai-auth";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { tenantWhatsAppFrom } from "@/lib/whatsapp/from";
import { sendWhatsAppMeta } from "@/lib/whatsapp/meta";

export async function POST(req: NextRequest) {
  // Accept either: (a) valid x-ai-secret (n8n/Vapi) or (b) a signed-in dashboard session.
  // This lets /pending and other dashboard pages call this endpoint from the browser
  // (same-origin cookies) without embedding the shared secret in the JS bundle.
  const unauth = assertAiSecret(req);
  if (unauth) {
    try {
      const supabase = await createServerSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return unauth;
    } catch {
      return unauth;
    }
  }
  try {
    const { to, message, tenant_id } = await req.json();

    if (!to || !message) {
      return NextResponse.json({ error: "Missing 'to' or 'message'" }, { status: 400 });
    }

    // Send FROM the tenant's own Meta number when the caller names a tenant;
    // otherwise the platform default. One source of truth (resolveWhatsAppFrom,
    // inside sendWhatsAppMeta) — no number hardcoded here. Today every tenant
    // resolves to the same shared Meta number until a customer sets
    // settings.whatsapp.from to its own phone_number_id.
    let tenantFrom: string | undefined;
    if (tenant_id) {
      const { data: tenantRow } = await createServiceRoleClient()
        .from("tenants")
        .select("settings")
        .eq("id", tenant_id)
        .maybeSingle();
      tenantFrom = tenantWhatsAppFrom(tenantRow?.settings);
    }

    const result = await sendWhatsAppMeta(to, message, tenantFrom);

    const normalizedTo = to.replace(/^whatsapp:/, "").trim();
    const errorKey = `meta:whatsapp:${normalizedTo}`;

    if (!result.ok) {
      logSystemEvent({
        category: "message_failure",
        severity: "high",
        title: `WhatsApp send failed to ${to}`,
        description: result.errorMessage || "Meta error",
        metadata: { to, metaError: result.error },
        error_key: errorKey,
      });
      return NextResponse.json(
        { error: result.errorMessage || "Meta error", details: result.error },
        { status: result.status || 502 }
      );
    }

    // Recovery: questa chiamata Meta ha funzionato → chiudi gli open per stesso
    // destinatario e per "whatsapp service down" globale.
    void resolveSystemEvents({ error_key: errorKey });
    void resolveSystemEvents({ error_key: "meta:service" });

    return NextResponse.json({ success: true, message_id: result.messageId });
  } catch (err: any) {
    logSystemEvent({
      category: "message_failure",
      severity: "critical",
      title: "WhatsApp send crashed",
      description: err.message,
      error_key: "meta:service",
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
