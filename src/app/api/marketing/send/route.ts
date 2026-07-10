import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { getFeatures } from "@/lib/types/tenant-settings";
import { sendCampaign, resolveRecipients, MAX_RECIPIENTS, type CampaignRow } from "@/lib/marketing/send";
import { logAuditEvent } from "@/lib/audit";
import type { SegmentDef } from "@/lib/guests/segmentation";

// Create-and-send a campaign (Fase 3). One request: validates, persists the
// campaign row (audit trail even on failure), then delivers inline — capped at
// MAX_RECIPIENTS per run; re-POST with campaign_id resumes pending/failed rows.
// Roles: owner/manager, plus the dedicated 'marketing' role.

export const maxDuration = 60;

const CHANNELS = new Set(["email", "whatsapp"]);
const SEGMENT_KINDS = new Set(["all", "lapsed", "vip", "birthday", "tag", "no_show_risk"]);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
    const member = await verifyTenantMembership(tenantId, ["owner", "manager", "marketing"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const svc = createServiceRoleClient();
    const { data: tenant } = await svc
      .from("tenants")
      .select("id, name, settings")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!getFeatures(tenant.settings).marketing_enabled) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 403 });
    }

    let campaign: CampaignRow;
    if (body.campaign_id) {
      // Resume an existing campaign (retry failed/pending rows).
      const { data } = await svc
        .from("campaigns")
        .select("id, tenant_id, channel, segment, subject, body")
        .eq("id", String(body.campaign_id))
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
      campaign = data as CampaignRow;
    } else {
      const channel = String(body.channel || "");
      const segment = body.segment as SegmentDef;
      const text = String(body.body || "").trim();
      const name = String(body.name || "").trim();
      if (!CHANNELS.has(channel)) return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
      if (!segment || !SEGMENT_KINDS.has(segment.kind)) return NextResponse.json({ error: "invalid_segment" }, { status: 400 });
      if (!text || !name) return NextResponse.json({ error: "name and body required" }, { status: 400 });

      const { data, error } = await svc
        .from("campaigns")
        .insert({
          tenant_id: tenantId,
          name,
          channel,
          segment,
          subject: String(body.subject || "").trim() || null,
          body: text.slice(0, 4000),
          status: "sending",
          created_by: member.userId,
        })
        .select("id, tenant_id, channel, segment, subject, body")
        .single();
      if (error) throw error;
      campaign = data as CampaignRow;
    }

    const counters = await sendCampaign(svc, campaign, tenant);

    await logAuditEvent({
      tenant_id: tenantId,
      action: "campaign_sent",
      entity_id: campaign.id,
      idempotency_key: `campaign_sent_${campaign.id}_${counters.sent}`,
      source: "staff",
      details: { ...counters, channel: campaign.channel, by: member.userId, cap: MAX_RECIPIENTS },
    });

    return NextResponse.json({ success: true, campaign_id: campaign.id, ...counters });
  } catch (e) {
    console.error("[marketing/send]", e);
    return NextResponse.json({ error: "internal", detail: e instanceof Error ? e.message : undefined }, { status: 500 });
  }
}

// Audience preview: how many guests the segment matches right now.
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const segment = body.segment as SegmentDef;
    if (!tenantId || !segment?.kind) return NextResponse.json({ error: "tenant_id and segment required" }, { status: 400 });
    const member = await verifyTenantMembership(tenantId, ["owner", "manager", "marketing"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const svc = createServiceRoleClient();
    const { eligible, optedOut } = await resolveRecipients(svc, tenantId, segment);
    const withEmail = eligible.filter((g) => g.email).length;
    const withPhone = eligible.filter((g) => g.phone).length;
    return NextResponse.json({
      success: true,
      total: eligible.length,
      with_email: withEmail,
      with_phone: withPhone,
      opted_out: optedOut,
      sample: eligible.slice(0, 5).map((g) => g.name),
    });
  } catch (e) {
    console.error("[marketing/preview]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
