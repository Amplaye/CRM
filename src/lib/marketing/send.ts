// Campaign send orchestration (server-only). Resolves the stored SegmentDef
// against fresh guests+reservations, writes the campaign_recipients ledger,
// then delivers channel by channel:
//   email    → Resend, one send per recipient (personalized unsubscribe link)
//   whatsapp → approved MARKETING template `marketing_campaign`
//              ({{1}}=name {{2}}=body — outside the 24h window by definition)
//
// Idempotency: the unique (campaign_id, guest_id) row is claimed BEFORE the
// provider call; a retry re-sends only rows still 'pending'/'failed'. Opt-outs
// and missing contact fields become 'skipped' rows so the owner sees WHY a
// segment of 100 delivered 87.
//
// Scale note (dev stage, no real clients): delivery is an inline loop capped
// at MAX_RECIPIENTS. The n8n bulk path (enqueueBulkEmail) takes over when
// campaigns outgrow a single Vercel invocation — see project_n8n_scaling.

import { sendEmail } from "@/lib/email/send";
import { renderEmailLayout, escapeHtml } from "@/lib/email/templates/base";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/meta";
import { tenantWhatsAppFrom } from "@/lib/whatsapp/from";
import { createUnsubscribeToken } from "./unsubscribe";
import { applySegment, type SegmentDef, type SegmentGuest, type SegmentReservation } from "@/lib/guests/segmentation";
import type { TenantSettings } from "@/lib/types/tenant-settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any;

export const MAX_RECIPIENTS = 500;

export interface CampaignRow {
  id: string;
  tenant_id: string;
  channel: "email" | "whatsapp" | "sms";
  segment: SegmentDef;
  subject: string | null;
  body: string;
}

interface TenantRow {
  id: string;
  name: string;
  settings: TenantSettings | null;
}

/** Resolve the campaign's audience NOW (segment × opt-out × has-contact). */
export async function resolveRecipients(
  svc: Svc,
  tenantId: string,
  segment: SegmentDef,
): Promise<{ eligible: SegmentGuest[]; optedOut: number }> {
  const [{ data: guests }, { data: reservations }] = await Promise.all([
    svc
      .from("guests")
      .select("id, name, phone, email, visit_count, no_show_count, estimated_spend, tags, birthday, marketing_opt_out")
      .eq("tenant_id", tenantId),
    svc.from("reservations").select("guest_id, date, status").eq("tenant_id", tenantId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const all = applySegment(
    (guests || []) as (SegmentGuest & { marketing_opt_out?: boolean })[],
    (reservations || []) as SegmentReservation[],
    segment,
    today,
  ) as (SegmentGuest & { marketing_opt_out?: boolean })[];
  const eligible = all.filter((g) => !g.marketing_opt_out);
  return { eligible, optedOut: all.length - eligible.length };
}

/** Send (or resume) a campaign. Returns the updated counters. */
export async function sendCampaign(
  svc: Svc,
  campaign: CampaignRow,
  tenant: TenantRow,
): Promise<{ recipients: number; sent: number; failed: number; skipped: number }> {
  const { eligible } = await resolveRecipients(svc, campaign.tenant_id, campaign.segment);
  const capped = eligible.slice(0, MAX_RECIPIENTS);

  // Claim ledger rows first (unique constraint = the idempotency).
  if (capped.length) {
    await svc.from("campaign_recipients").upsert(
      capped.map((g) => ({
        tenant_id: campaign.tenant_id,
        campaign_id: campaign.id,
        guest_id: g.id,
      })),
      { onConflict: "campaign_id,guest_id", ignoreDuplicates: true },
    );
  }
  const { data: ledger } = await svc
    .from("campaign_recipients")
    .select("id, guest_id, status")
    .eq("campaign_id", campaign.id);
  const pendingIds = new Set(
    ((ledger || []) as { id: string; guest_id: string; status: string }[])
      .filter((r) => r.status === "pending" || r.status === "failed")
      .map((r) => r.guest_id),
  );

  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://crm.baliflowagency.com";
  const from = tenantWhatsAppFrom(tenant.settings);
  const branding = {
    name: tenant.name,
    brand_color: tenant.settings?.menu_branding?.brand_color,
    logo_url: tenant.settings?.menu_branding?.logo_url,
  };
  const lang = (tenant.settings?.bot_config?.primary_language || "es").slice(0, 2);
  const UNSUB = { es: "Darse de baja", it: "Disiscriviti", en: "Unsubscribe", de: "Abmelden" } as const;
  const unsubLabel = UNSUB[lang as keyof typeof UNSUB] || UNSUB.es;

  let sent = 0, failed = 0, skipped = 0;
  for (const g of capped) {
    if (!pendingIds.has(g.id)) continue; // already delivered on a previous run

    const mark = (status: "sent" | "failed" | "skipped", error?: string) =>
      svc
        .from("campaign_recipients")
        .update({ status, error: error || null, sent_at: status === "sent" ? new Date().toISOString() : null })
        .eq("campaign_id", campaign.id)
        .eq("guest_id", g.id);

    try {
      if (campaign.channel === "email") {
        if (!g.email) { skipped++; await mark("skipped", "no_email"); continue; }
        const unsubUrl = `${origin}/u/${createUnsubscribeToken({ g: g.id, t: campaign.tenant_id })}`;
        const html = renderEmailLayout({
          branding,
          preheader: campaign.subject || undefined,
          bodyHtml: `<p>${escapeHtml(campaign.body).replace(/\n/g, "<br/>")}</p>`,
          footerHtml: `<a href="${unsubUrl}" style="color:#111827;text-decoration:underline;">${unsubLabel}</a>`,
        });
        await sendEmail({
          to: g.email,
          subject: campaign.subject || tenant.name,
          html,
          idempotencyKey: `campaign_${campaign.id}_${g.id}`,
        });
        sent++; await mark("sent");
      } else if (campaign.channel === "whatsapp") {
        if (!g.phone) { skipped++; await mark("skipped", "no_phone"); continue; }
        const res = await sendWhatsAppTemplate(
          g.phone,
          "marketing_campaign",
          lang,
          [g.name || "", campaign.body],
          from,
        );
        if (res.ok) { sent++; await mark("sent"); }
        else { failed++; await mark("failed", res.errorMessage); }
      } else {
        // SMS: legacy Twilio path not wired for campaigns yet.
        skipped++; await mark("skipped", "channel_not_supported");
      }
    } catch (e) {
      failed++;
      await mark("failed", e instanceof Error ? e.message.slice(0, 300) : "error");
    }
  }

  const counters = {
    recipients: capped.length,
    sent,
    failed,
    skipped,
  };
  await svc
    .from("campaigns")
    .update({
      status: failed && !sent ? "failed" : "sent",
      recipient_count: capped.length,
      sent_count: sent,
      failed_count: failed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign.id);

  return counters;
}
