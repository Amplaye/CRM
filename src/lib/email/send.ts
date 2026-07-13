// Minimal Resend REST client — no SDK dependency, same idiom as
// src/lib/billing/stripe.ts. Resend's API is a single JSON POST, so a fetch
// wrapper covers everything and adds zero packages.
//
// THERE IS NO SHARED PLAN AND NO PLATFORM FALLBACK KEY (owner decision). Every
// email the CRM sends for a tenant — campaign, coupon, gift card, confirmation —
// goes out on THAT TENANT's own Resend account, or it does not go out at all.
//
// Which is why `apiKey` and `from` are required parameters rather than optional
// ones with an env default: a call site that forgets either fails to compile. An
// `|| process.env.RESEND_API_KEY` fallback is precisely how a shared pool grows
// back by accident, one "temporary" call site at a time. Resolve both from
// resolveTenantEmail() (src/lib/email/credentials.ts) and skip the send when it
// returns null.
//
// Not sent from here: signup confirmation and password recovery. Those are
// Supabase Auth's own SMTP — project-wide, not per-tenant — and they are what
// lets an owner reach the screen where they paste their key in the first place.
// Gating them on that same key would lock every new tenant out of its account.

const API = "https://api.resend.com";

export type EmailKind = "marketing" | "transactional";

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** The tenant's OWN Resend key. Required — see the header. */
  apiKey: string;
  /** Full From header, e.g. `Ristorante Picnic <noreply@ristorantepicnic.com>`.
   * The address MUST sit on a domain verified inside the account `apiKey`
   * belongs to, or Resend answers 403. Build it with resolveEmailFrom(). */
  from: string;
  replyTo?: string;
  /** Idempotency key — Resend dedupes sends sharing one within 24h. Pass a
   * stable id (e.g. `campaign_${campaignId}_${guestId}`) wherever a retry
   * must not double-send. */
  idempotencyKey?: string;
  /** Set to count this send in the tenant's monthly email counter. Skipping it
   * only means the send goes unlogged — it never blocks delivery. */
  tenantId?: string;
  /** Which of the tenant's two Resend quotas this send draws from. Campaign
   * sends pass 'marketing'; everything else is transactional. */
  kind?: EmailKind;
}

/** Send one email via the tenant's Resend account. Returns the Resend email id.
 * Throws on HTTP/API errors — callers decide whether that's fatal (checkout
 * receipt) or loggable (marketing follow-up). */
export async function sendEmail(params: SendEmailParams): Promise<{ id: string }> {
  if (!params.apiKey) throw new Error("email_not_configured: no Resend key for this tenant");
  if (!params.from) throw new Error("email_not_configured: no sender address for this tenant");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    "Content-Type": "application/json",
  };
  if (params.idempotencyKey) headers["Idempotency-Key"] = params.idempotencyKey;

  const res = await fetch(`${API}/emails`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: params.from,
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
      reply_to: params.replyTo,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    message?: string;
  };
  if (!res.ok) throw new Error(json?.message || `Resend ${res.status}`);
  await logEmailSend(params.tenantId, params.kind || "transactional");
  return { id: String(json.id) };
}

/** Append one row to email_send_log so Settings → Email can say "742 / 1.000 this
 * month". Best-effort by design: this runs AFTER Resend already accepted the
 * email, so a logging failure must never surface as a send failure — the counter
 * being off by one is strictly better than a lost booking confirmation. */
async function logEmailSend(tenantId: string | undefined, kind: EmailKind): Promise<void> {
  if (!tenantId) return;
  try {
    const { createServiceRoleClient } = await import("@/lib/supabase/server");
    await createServiceRoleClient()
      .from("email_send_log")
      // own_key is now a tautology (there is no other kind of send), but the
      // column is NOT NULL — keep writing it rather than run a migration.
      .insert({ tenant_id: tenantId, kind, own_key: true });
  } catch {
    // swallow — see above
  }
}
