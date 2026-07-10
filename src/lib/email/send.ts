// Minimal Resend REST client — no SDK dependency, same idiom as
// src/lib/billing/stripe.ts. Resend's API is a single JSON POST, so a fetch
// wrapper covers everything (transactional sends) and adds zero packages.
// The moment RESEND_API_KEY lands in env this works; until then
// `emailConfigured()` is false and callers degrade gracefully (skip + log),
// mirroring how stripeConfigured() gates checkout.
//
// Two send paths by design (user decision, plan Fase 0):
//  - sendEmail()        → direct Resend call. Transactional one-offs (deposit
//                         link, gift-card delivery, review follow-up).
//  - enqueueBulkEmail() → hands a batch to n8n for orchestration. Campaign /
//                         mass sends, so Vercel never loops over hundreds of
//                         recipients inside one request.

const API = "https://api.resend.com";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Default sender. Domain must be verified in Resend (DNS) before real sends. */
function defaultFrom(): string {
  return process.env.EMAIL_FROM || "TableFlow <onboarding@resend.dev>";
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Override the platform sender, e.g. a tenant-branded name. Address part
   * must still be on a Resend-verified domain. */
  from?: string;
  replyTo?: string;
  /** Idempotency key — Resend dedupes sends sharing one within 24h. Pass a
   * stable id (e.g. `campaign_${campaignId}_${guestId}`) wherever a retry
   * must not double-send. */
  idempotencyKey?: string;
}

/** Send one transactional email via Resend. Returns the Resend email id.
 * Throws on HTTP/API errors — callers decide whether that's fatal (checkout
 * receipt) or loggable (marketing follow-up). */
export async function sendEmail(params: SendEmailParams): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (params.idempotencyKey) headers["Idempotency-Key"] = params.idempotencyKey;
  const res = await fetch(`${API}/emails`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: params.from || defaultFrom(),
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
  return { id: String(json.id) };
}

// ---------------------------------------------------------------------------
// Bulk path — n8n orchestration (campaigns). The CRM only ENQUEUES; n8n owns
// pacing, retries and per-recipient fan-out, keeping Vercel requests short
// (same reason booking-reminders/post-visit-followup are n8n-triggered).
// ---------------------------------------------------------------------------

const N8N_WEBHOOK_BASE = "https://n8n.srv1468837.hstgr.cloud/webhook";

export interface BulkEmailJob {
  tenant_id: string;
  campaign_id: string;
  /** Pre-rendered per-recipient payloads: n8n just delivers. */
  recipients: Array<{ to: string; subject: string; html: string; recipient_id: string }>;
}

/** Hand a campaign batch to the n8n email-dispatch workflow. Fire-and-forget
 * contract: a 2xx means n8n ACCEPTED the job, not that emails were sent —
 * delivery status flows back via /api/marketing/delivery-status. */
export async function enqueueBulkEmail(job: BulkEmailJob): Promise<void> {
  const url = process.env.N8N_EMAIL_WEBHOOK_URL || `${N8N_WEBHOOK_BASE}/email-campaign-dispatch`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  if (!res.ok) throw new Error(`n8n enqueue failed: ${res.status}`);
}
