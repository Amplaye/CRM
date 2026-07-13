// Campaign send orchestration (server-only). Resolves the stored SegmentDef
// against fresh guests+reservations, writes the campaign_recipients ledger,
// then delivers channel by channel:
//   email    → Resend, one send per recipient (personalized unsubscribe link)
//   whatsapp → approved MARKETING template `marketing_campaign_v2`
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
import { resolveEmailApiKey } from "@/lib/email/credentials";
import { resolveEmailFrom, resolveEmailBranding } from "@/lib/email/from";
import { renderEmailLayout, escapeHtml } from "@/lib/email/templates/base";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/meta";
import { tenantWhatsAppFrom } from "@/lib/whatsapp/from";
import { createUnsubscribeToken } from "./unsubscribe";
import { applySegment, type SegmentDef, type SegmentGuest, type SegmentReservation } from "@/lib/guests/segmentation";
import { whatsappPriceForPhone, EMAIL_EUR_PER_SEND } from "@/lib/marketing/pricing";
import { getCreditBalance, consumeCredits } from "@/lib/billing/credits";
import { mcFor } from "@/lib/billing/credits-catalog";
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

/** Send (or resume) a campaign. Returns the updated counters.
 *
 * `credits_exhausted` in the return means the wallet couldn't cover the whole
 * send and NOTHING was sent — see the pre-flight below. */
export async function sendCampaign(
  svc: Svc,
  campaign: CampaignRow,
  tenant: TenantRow,
): Promise<{ recipients: number; sent: number; failed: number; skipped: number; credits_exhausted?: boolean }> {
  const { eligible } = await resolveRecipients(svc, campaign.tenant_id, campaign.segment);
  const capped = eligible.slice(0, MAX_RECIPIENTS);

  // Credit pre-flight for the WHOLE campaign, before a single message goes out.
  //
  // Per-recipient checking would be worse than useless here: the wallet would
  // run dry somewhere around recipient 180 of 300, Meta would already have
  // billed us for those 180, and the owner would be left with a half-sent
  // campaign — some customers told about tonight's offer and some not. Refusing
  // the whole job up front is the only outcome that's actually recoverable: they
  // top up and press send again, and the ledger resumes cleanly.
  const action = campaign.channel === "email" ? "marketing_email" : "marketing_whatsapp";
  if (capped.length) {
    const needed = mcFor(action, capped.length);
    const balance = await getCreditBalance(campaign.tenant_id, svc).catch(() => null);
    // Fail-open on an unreadable wallet (as everywhere in the metering layer): a
    // Supabase blip must not stop a restaurant's campaign.
    if (balance && balance.totalRemainingMc < needed) {
      // Leave the campaign 'draft', NOT 'failed': nothing was attempted, and the
      // owner is meant to top up and press send again on this same campaign.
      // (`campaigns` has no `error` column — the reason travels back in the
      // return value, and the route turns it into a credits_exhausted response.)
      return { recipients: capped.length, sent: 0, failed: 0, skipped: 0, credits_exhausted: true };
    }
  }

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
  // Email identity: the guest reads the venue's NAME, while the address stays on
  // the platform's verified no-reply domain. Campaigns are send-only by design —
  // no Reply-To is set, and the body says so, so nobody writes into a void.
  const emailFrom = resolveEmailFrom(tenant.settings, tenant.name);
  // Whose Resend account this campaign goes out on: the tenant's own key when it
  // connected one (its free tier), otherwise null → the platform's shared pool.
  // Resolved ONCE for the whole campaign, not per recipient — it's a decrypt +
  // a query, and it cannot change mid-send.
  const tenantEmailKey =
    campaign.channel === "email" ? await resolveEmailApiKey(svc, campaign.tenant_id) : null;
  // Logo in alto al centro nell'email: risolto da site/CRM/menu branding, non
  // solo da menu_branding (vedi resolveEmailBranding).
  const branding = resolveEmailBranding(tenant.settings, tenant.name);
  const lang = (tenant.settings?.bot_config?.primary_language || "es").slice(0, 2);
  const UNSUB = { es: "Darse de baja", it: "Disiscriviti", en: "Unsubscribe", de: "Abmelden" } as const;
  const unsubLabel = UNSUB[lang as keyof typeof UNSUB] || UNSUB.es;
  const NOREPLY = {
    es: "Este mensaje se envía desde una dirección que no admite respuestas. Por favor, no respondas a este correo.",
    it: "Questo messaggio è inviato da un indirizzo che non accetta risposte. Ti preghiamo di non rispondere a questa email.",
    en: "This message is sent from an address that does not accept replies. Please do not reply to this email.",
    de: "Diese Nachricht wird von einer Adresse gesendet, die keine Antworten annimmt. Bitte antworte nicht auf diese E-Mail.",
  } as const;
  const noReplyNote = NOREPLY[lang as keyof typeof NOREPLY] || NOREPLY.es;

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
          footerHtml:
            `<p style="margin:0 0 8px;">${escapeHtml(noReplyNote)}</p>` +
            `<a href="${unsubUrl}" style="color:#111827;text-decoration:underline;">${unsubLabel}</a>`,
        });
        await sendEmail({
          to: g.email,
          subject: campaign.subject || tenant.name,
          html,
          from: emailFrom,
          // No replyTo on purpose: campaigns are send-only (owner decision).
          idempotencyKey: `campaign_${campaign.id}_${g.id}`,
          ...(tenantEmailKey ? { apiKey: tenantEmailKey } : {}),
          tenantId: campaign.tenant_id,
          kind: "marketing",
        });
        sent++; await mark("sent");
        // Debited per delivered message, not per intended one: a resumed campaign
        // skips already-'sent' rows above, so nobody is charged twice.
        await consumeCredits(campaign.tenant_id, "marketing_email", {
          costEur: EMAIL_EUR_PER_SEND,
          metadata: { campaign_id: campaign.id, guest_id: g.id },
        });
      } else if (campaign.channel === "whatsapp") {
        if (!g.phone) { skipped++; await mark("skipped", "no_phone"); continue; }
        const res = await sendWhatsAppTemplate(
          g.phone,
          "marketing_campaign_v2",
          lang,
          [g.name || "", campaign.body],
          from,
        );
        if (res.ok) {
          sent++; await mark("sent");
          // The tenant pays a FLAT 0,4 cr per recipient, but we record what Meta
          // actually charges us for THAT country (€0.015 US → €0.14 Germany) —
          // so the ledger shows the real margin per send instead of an assumed one.
          await consumeCredits(campaign.tenant_id, "marketing_whatsapp", {
            costEur: whatsappPriceForPhone(g.phone),
            metadata: { campaign_id: campaign.id, guest_id: g.id },
          });
        }
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
