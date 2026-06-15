import { describe, it, expect } from "vitest";
import {
  PILOT_PLANS,
  PILOT_FEE_CENTS,
  PILOT_FIRST_MONTH_CREDIT_CENTS,
  PILOT_TRIAL_DAYS,
  pilotMetadata,
  mapStripeSubStatus,
} from "./pilot";

// These guard the MONEY model and metadata contract — the parts that, if wrong,
// would over/under-charge a customer. The Stripe wiring itself is covered by the
// test-mode checklist (network-dependent, not a unit test).

describe("pilot money model", () => {
  it("charges €150 today and credits €150 to the first month for both plans", () => {
    expect(PILOT_FEE_CENTS).toBe(15000);
    expect(PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(15000);
    expect(PILOT_TRIAL_DAYS).toBe(14);
  });

  it("founder: €299/mo, first invoice €149 (= monthly − €150)", () => {
    const f = PILOT_PLANS.founder;
    expect(f.monthlyCents).toBe(29900);
    expect(f.firstInvoiceCents).toBe(14900);
    expect(f.monthlyCents - PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(f.firstInvoiceCents);
    expect(f.monthlyPriceEnv).toBe("STRIPE_FOUNDER_MONTHLY_PRICE_ID");
  });

  it("premium: €399/mo, first invoice €249 (= monthly − €150)", () => {
    const p = PILOT_PLANS.premium;
    expect(p.monthlyCents).toBe(39900);
    expect(p.firstInvoiceCents).toBe(24900);
    expect(p.monthlyCents - PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(p.firstInvoiceCents);
    expect(p.monthlyPriceEnv).toBe("STRIPE_PREMIUM_MONTHLY_PRICE_ID");
  });

  it("the first-month credit never makes today's charge €0 (req 14)", () => {
    // Today's fee is independent of the credit; both are €150, applied to different
    // moments (today vs first invoice), never netted against each other.
    expect(PILOT_FEE_CENTS).toBeGreaterThan(0);
  });
});

describe("pilot metadata (req 9)", () => {
  it("stamps the required keys on every object", () => {
    const m = pilotMetadata("founder");
    expect(m).toMatchObject({
      product: "BALI Flow",
      flow: "paid_pilot_to_subscription",
      plan: "founder",
      pilot_fee: "150",
      first_month_credit: "150",
    });
  });

  it("merges extra keys", () => {
    expect(pilotMetadata("premium", { stripe_checkout_session_id: "cs_x" })).toMatchObject({
      plan: "premium",
      stripe_checkout_session_id: "cs_x",
    });
  });
});

describe("mapStripeSubStatus", () => {
  it("maps Stripe statuses to our enum", () => {
    expect(mapStripeSubStatus("trialing")).toBe("trialing");
    expect(mapStripeSubStatus("active")).toBe("active");
    expect(mapStripeSubStatus("past_due")).toBe("past_due");
    expect(mapStripeSubStatus("unpaid")).toBe("past_due");
    expect(mapStripeSubStatus("canceled")).toBe("canceled");
    expect(mapStripeSubStatus("incomplete_expired")).toBe("incomplete");
  });
});
