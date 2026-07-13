import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { resolveEmailFrom, tenantReplyTo, emailSenderConfigured } from "@/lib/email/from";
import type { TenantSettings } from "@/lib/types/tenant-settings";

// Email sender identity for campaigns (Marketing → mittente).
//
//   GET   ?tenant_id=…              → current sender_name / reply_to + the
//                                     resolved From the guest will actually see
//   PATCH { tenant_id, sender_name, reply_to }
//
// Only the display NAME and the REPLY-TO are tenant-editable: the address must
// stay on the platform's DNS-verified domain or the ESP refuses the send
// (see src/lib/email/from.ts).

export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenant_id") || "";
  if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  const member = await verifyTenantMembership(tenantId, ["owner", "manager", "marketing"]);
  if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const svc = createServiceRoleClient();
  const { data: tenant } = await svc.from("tenants").select("name, settings").eq("id", tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const settings = tenant.settings as TenantSettings | null;
  return NextResponse.json({
    success: true,
    sender_name: settings?.marketing_email?.sender_name || tenant.name || "",
    reply_to: settings?.marketing_email?.reply_to || "",
    /** Exactly what the guest sees in the From column. */
    resolved_from: resolveEmailFrom(settings, tenant.name),
    resolved_reply_to: tenantReplyTo(settings) || null,
    /** False → EMAIL_FROM unset, so sends fall back to Resend's sandbox address. */
    domain_configured: emailSenderConfigured(),
  });
}

export async function PATCH(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId = String(body.tenant_id || "");
  if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  const member = await verifyTenantMembership(tenantId, ["owner", "manager", "marketing"]);
  if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const senderName = String(body.sender_name ?? "").trim().slice(0, 80);
  const replyTo = String(body.reply_to ?? "").trim().slice(0, 160);
  if (replyTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo)) {
    return NextResponse.json({ error: "invalid_reply_to" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: tenant } = await svc.from("tenants").select("name, settings").eq("id", tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const settings = { ...((tenant.settings as Record<string, unknown>) || {}) };
  settings.marketing_email = {
    ...((settings.marketing_email as Record<string, unknown>) || {}),
    sender_name: senderName || undefined,
    reply_to: replyTo || undefined,
  };

  const { error } = await svc.from("tenants").update({ settings }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    resolved_from: resolveEmailFrom(settings as TenantSettings, tenant.name),
    resolved_reply_to: tenantReplyTo(settings as TenantSettings) || null,
  });
}
