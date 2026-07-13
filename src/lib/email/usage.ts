// Monthly email counter (Settings → Email). Answers the one question the owner
// actually has: "how many emails can I still send this month?"
//
// Source of truth is email_send_log — one row per email Resend accepted, written
// by sendEmail(). campaign_recipients would only cover campaigns, and the free
// tier is consumed by transactional sends too (gift cards, deposit links), so
// counting from the log is the only way the number matches reality.
//
// The limits reported depend on WHOSE Resend account the send lands on:
//   own key    → the tenant's free tier: 1.000 marketing contacts, 3.000
//                transactional emails per month (resend.com/pricing).
//   shared pool → the platform's account, which the tenant doesn't own and whose
//                quota it shares with every other tenant. Reporting the tenant a
//                slice of that would be a number it can't act on, so `limit` is
//                null there — the UI says "shared plan" and shows only the count.

import { resolveEmailApiKey } from "./credentials";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any;

/** Resend's free tier, per calendar month. */
export const RESEND_FREE_MARKETING_LIMIT = 1000;
export const RESEND_FREE_TRANSACTIONAL_LIMIT = 3000;

export interface EmailQuota {
  sent: number;
  /** null = no per-tenant cap to show (shared platform pool). */
  limit: number | null;
}

export interface EmailUsage {
  /** true → sends go out on the tenant's own Resend account. */
  ownKey: boolean;
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
  const ownKey = !!(await resolveEmailApiKey(svc, tenantId));
  const limits = ownKey
    ? { marketing: RESEND_FREE_MARKETING_LIMIT, transactional: RESEND_FREE_TRANSACTIONAL_LIMIT }
    : { marketing: null, transactional: null };

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
      ownKey,
      marketing: { sent: marketing, limit: limits.marketing },
      transactional: { sent: transactional, limit: limits.transactional },
    };
  } catch {
    return {
      ownKey,
      marketing: { sent: 0, limit: limits.marketing },
      transactional: { sent: 0, limit: limits.transactional },
    };
  }
}
