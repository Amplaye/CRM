import { describe, it, expect, beforeAll } from "vitest";
import { encryptEmailSecret } from "./credentials";
import {
  getEmailUsageThisMonth,
  RESEND_FREE_MARKETING_LIMIT,
  RESEND_FREE_TRANSACTIONAL_LIMIT,
} from "./usage";

// The counter's job: report a limit the tenant can act on. That only exists when
// the tenant owns the Resend account — on the shared pool the quota isn't theirs,
// so `limit` must be null rather than a made-up slice of the platform's plan.

beforeAll(() => {
  process.env.EMAIL_CRED_ENC_KEY = "b".repeat(64);
});

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

describe("getEmailUsageThisMonth", () => {
  it("reports the Resend free-tier limits when the tenant owns the account", async () => {
    const svc = fakeSvc({
      secretEnc: encryptEmailSecret({ api_key: "re_own" }),
      counts: { marketing: 742, transactional: 120 },
    });
    const usage = await getEmailUsageThisMonth("tenant-1", svc);
    expect(usage.ownKey).toBe(true);
    expect(usage.marketing).toEqual({ sent: 742, limit: RESEND_FREE_MARKETING_LIMIT });
    expect(usage.transactional).toEqual({ sent: 120, limit: RESEND_FREE_TRANSACTIONAL_LIMIT });
  });

  it("reports no limit on the shared pool — the quota isn't the tenant's to spend", async () => {
    const svc = fakeSvc({ secretEnc: null, counts: { marketing: 12, transactional: 30 } });
    const usage = await getEmailUsageThisMonth("tenant-1", svc);
    expect(usage.ownKey).toBe(false);
    expect(usage.marketing).toEqual({ sent: 12, limit: null });
    expect(usage.transactional).toEqual({ sent: 30, limit: null });
  });

  it("counts zero when the tenant has sent nothing this month", async () => {
    const usage = await getEmailUsageThisMonth("tenant-1", fakeSvc({ secretEnc: null }));
    expect(usage.marketing.sent).toBe(0);
    expect(usage.transactional.sent).toBe(0);
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
