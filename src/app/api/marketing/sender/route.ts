import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { resolveEmailFrom, emailSenderConfigured } from "@/lib/email/from";
import type { TenantSettings } from "@/lib/types/tenant-settings";

// Email sender identity for campaigns (Marketing → mittente).
//
//   GET   ?tenant_id=…                  → current sender_name + the resolved From
//                                         the guest will actually see
//   PATCH { tenant_id, sender_name }
//
// Only the display NAME is tenant-editable: the address must stay on the
// platform's DNS-verified no-reply domain or the ESP refuses the send. Campaigns
// are send-only — no Reply-To (see src/lib/email/from.ts).

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
    /** Exactly what the guest sees in the From column. */
    resolved_from: resolveEmailFrom(settings, tenant.name),
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

  const svc = createServiceRoleClient();
  const { data: tenant } = await svc.from("tenants").select("name, settings").eq("id", tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const settings = { ...((tenant.settings as Record<string, unknown>) || {}) };
  settings.marketing_email = { sender_name: senderName || undefined };

  const { error } = await svc.from("tenants").update({ settings }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    resolved_from: resolveEmailFrom(settings as TenantSettings, tenant.name),
  });
}
