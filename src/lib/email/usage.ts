// Monthly email counter (Settings → Email). Answers the one question the owner
// actually has: "how many emails can I still send this month?"
//
// Source of truth is email_send_log — one row per email Resend accepted, written
// by sendEmail(). campaign_recipients would only cover campaigns, and the free
// tier is consumed by transactional sends too (gift cards, coupons), so counting
// from the log is the only way the number matches reality.
//
// The limits are always the tenant's OWN free tier, because that is the only
// account its email ever goes out on: 1.000 marketing contacts and 3.000
// transactional emails per month (resend.com/pricing). There is no shared
// platform plan to report a slice of — `connected: false` means nothing is being
// sent at all, not that it's being sent somewhere else.

import { resolveTenantEmail } from "./credentials";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any;

/** Resend's free tier, per calendar month. */
export const RESEND_FREE_MARKETING_LIMIT = 1000;
export const RESEND_FREE_TRANSACTIONAL_LIMIT = 3000;

export interface EmailQuota {
  sent: number;
  limit: number;
}

export interface EmailUsage {
  /** false → this tenant has no Resend key (or no verified sender) connected,
   *  so the CRM sends NO email for it: not campaigns, not coupons, nothing. */
  connected: boolean;
  marketing: EmailQuota;
  transactional: EmailQuota;
}

/** First instant of the current calendar month, UTC — the boundary Resend itself
 * resets quotas on. */
function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Sends this tenant made this month, split by quota. Fails soft to zeros: a
 * broken counter must not break the Settings page. */
export async function getEmailUsageThisMonth(tenantId: string, svc: Svc): Promise<EmailUsage> {
  const connected = !!(await resolveTenantEmail(svc, tenantId));
  const zero: EmailUsage = {
    connected,
    marketing: { sent: 0, limit: RESEND_FREE_MARKETING_LIMIT },
    transactional: { sent: 0, limit: RESEND_FREE_TRANSACTIONAL_LIMIT },
  };

  const since = monthStartIso();
  const count = async (kind: "marketing" | "transactional"): Promise<number> => {
    const { count: n } = await svc
      .from("email_send_log")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("kind", kind)
      .gte("sent_at", since);
    return n || 0;
  };

  try {
    const [marketing, transactional] = await Promise.all([count("marketing"), count("transactional")]);
    return {
      connected,
      marketing: { sent: marketing, limit: RESEND_FREE_MARKETING_LIMIT },
      transactional: { sent: transactional, limit: RESEND_FREE_TRANSACTIONAL_LIMIT },
    };
  } catch {
    return zero;
  }
}
