import { NextRequest, NextResponse } from "next/server";
import { logSystemEvent, resolveSystemEvents } from "@/lib/system-log";
import { assertAiSecret } from "@/lib/ai-auth";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { tenantWhatsAppFrom } from "@/lib/whatsapp/from";
import { sendWhatsAppMeta } from "@/lib/whatsapp/meta";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { isImpersonatingTenant } from "@/lib/impersonation";
import { apiError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  // Accept either: (a) valid x-ai-secret (n8n/Vapi) or (b) a signed-in dashboard session.
  // This lets /pending and other dashboard pages call this endpoint from the browser
  // (same-origin cookies) without embedding the shared secret in the JS bundle.
  const unauth = assertAiSecret(req);
  const viaSecret = !unauth;
  if (!viaSecret) {
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

    // Session callers may only send on behalf of a tenant they belong to;
    // otherwise a logged-in host of one tenant could send WhatsApp as another.
    // Secret callers (n8n/Vapi) are trusted to pass the right tenant_id.
    if (!viaSecret && tenant_id) {
      const member = await verifyTenantMembership(tenant_id);
      if (!member) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Safety: when a platform admin is operating AS this tenant from the
      // command center, do NOT fire real WhatsApp to the tenant's real guests
      // (or owner). The admin is managing data, not acting for the restaurant.
      // Secret callers (the actual bot via n8n/Vapi) are never suppressed.
      if (await isImpersonatingTenant(tenant_id)) {
        logSystemEvent({
          tenant_id,
          category: "system",
          severity: "low",
          title: "WhatsApp send suppressed during impersonation",
          description: `Admin is operating as this tenant; outbound message to ${to} was not sent.`,
          metadata: { to },
        });
        return NextResponse.json({ success: true, suppressed: true });
      }
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

    // Meta sandbox: a send to a number not on the test allow-list fails with code
    // 131030 ("Recipient phone number not in allowed list"). On the shared sandbox
    // number this is an EXPECTED test artifact (E2E numbers are never whitelisted),
    // not a platform fault — logging it as a high-severity message_failure only
    // spams the bug board. Skip the system event for 131030; still return the error
    // to the caller so the flow knows the send didn't land.
    const metaErrorCode = (result.error as { error?: { code?: number } } | undefined)?.error?.code;
    const isSandboxNotAllowed = metaErrorCode === 131030;

    if (!result.ok) {
      if (!isSandboxNotAllowed) {
        logSystemEvent({
          category: "message_failure",
          severity: "high",
          title: `WhatsApp send failed to ${to}`,
          description: result.errorMessage || "Meta error",
          metadata: { to, metaError: result.error },
          error_key: errorKey,
        });
      }
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
    return apiError(err, { route: "send-whatsapp", publicMessage: "operation_failed", status: 500 });
  }
}
