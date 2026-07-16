import { describe, it, expect } from "vitest";
import { encryptEmailSecret } from "./credentials";
import {
  getEmailUsageThisMonth,
  RESEND_FREE_MARKETING_LIMIT,
  RESEND_FREE_TRANSACTIONAL_LIMIT,
} from "./usage";

// `connected` is the load-bearing flag: false means this tenant sends NO email at
// all (no shared platform pool to fall back on), not that it sends somewhere else.
// And it takes BOTH halves — a key with no verified sender address can't send a
// single mail, so it must not read as connected.

// Set before the fixtures below encrypt anything — a beforeAll() would run too late.
process.env.EMAIL_CRED_ENC_KEY = "b".repeat(64);

/** Stands in for the service-role client: one email_secrets row (or none) and a
 * per-kind count for email_send_log. */
function fakeSvc(opts: { secretEnc?: string | null; counts?: Record<string, number> }) {
  const counts = opts.counts || {};
  return {
    from(table: string) {
      if (table === "email_secrets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: opts.secretEnc ? { secret_enc: opts.secretEnc } : null }) }),
            }),
          }),
        };
      }
      // email_send_log: .select(head+count).eq(tenant).eq(kind).gte(sent_at)
      let kind = "";
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === "kind") kind = val;
          return chain;
        },
        gte: async () => ({ count: counts[kind] ?? 0 }),
      };
      return chain;
    },
  };
}

const connectedSecret = encryptEmailSecret({
  api_key: "re_own",
  from_address: "noreply@ristorantepicnic.com",
});

describe("getEmailUsageThisMonth", () => {
  it("reports the tenant's own Resend free-tier limits once it's connected", async () => {
    const svc = fakeSvc({ secretEnc: connectedSecret, counts: { marketing: 742, transactional: 120 } });
    const usage = await getEmailUsageThisMonth("tenant-1", svc);
    expect(usage.connected).toBe(true);
    expect(usage.marketing).toEqual({ sent: 742, limit: RESEND_FREE_MARKETING_LIMIT });
    expect(usage.transactional).toEqual({ sent: 120, limit: RESEND_FREE_TRANSACTIONAL_LIMIT });
  });

  it("is NOT connected with no key — the tenant sends nothing at all", async () => {
    const usage = await getEmailUsageThisMonth("tenant-1", fakeSvc({ secretEnc: null }));
    expect(usage.connected).toBe(false);
    expect(usage.marketing.sent).toBe(0);
    expect(usage.transactional.sent).toBe(0);
  });

  it("is NOT connected with a key but no verified sender — every send would 403", async () => {
    const svc = fakeSvc({ secretEnc: encryptEmailSecret({ api_key: "re_own" }) });
    expect((await getEmailUsageThisMonth("tenant-1", svc)).connected).toBe(false);
  });

  it("still reports the real limits, so the bar has a ceiling to fill", async () => {
    const usage = await getEmailUsageThisMonth("tenant-1", fakeSvc({ secretEnc: null }));
    expect(usage.marketing.limit).toBe(RESEND_FREE_MARKETING_LIMIT);
    expect(usage.transactional.limit).toBe(RESEND_FREE_TRANSACTIONAL_LIMIT);
  });

  it("fails soft to zeros when the log query blows up", async () => {
    const broken = {
      from(table: string) {
        if (table === "email_secrets") {
          return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };
        }
        throw new Error("db down");
      },
    };
    const usage = await getEmailUsageThisMonth("tenant-1", broken);
    expect(usage.marketing.sent).toBe(0);
    expect(usage.transactional.sent).toBe(0);
  });
});
