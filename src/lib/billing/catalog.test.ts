import { describe, it, expect, afterEach } from "vitest";
import {
  PLANS,
  ADDONS,
  getPlan,
  getAddon,
  planAmount,
  formatEur,
  bundleableAddons,
  bundleTotal,
  resolveStripePriceId,
  resolvePaypalPlanId,
} from "./catalog";

// The catalog is the single source of truth for what a restaurant pays. These
// numbers must match the public pricing page (restaurants.baliflowagency.com) —
// a regression here silently overcharges or undercharges a real client.

describe("billing catalog — prices match the pricing page", () => {
  it("Premium = €399/mo, €3990/yr (2 months free)", () => {
    const p = getPlan("premium")!;
    expect(p.monthly).toBe(399);
    expect(p.yearly).toBe(3990);
    // Yearly is exactly 10 months of the monthly price (2 free).
    expect(p.yearly).toBe(p.monthly * 10);
  });

  it("Business = €329/mo, €3290/yr (2 months free)", () => {
    const p = getPlan("business")!;
    expect(p.monthly).toBe(329);
    expect(p.yearly).toBe(3290);
    expect(p.yearly).toBe(p.monthly * 10);
  });

  it("add-on prices: voice base €99/mo, voice premium €199/mo, design from €750, inventory €199/mo", () => {
    expect(getAddon("voice_vapi")!.amount).toBe(99);
    expect(getAddon("voice_retell")!.amount).toBe(199);
    expect(getAddon("website_design")!.amount).toBe(750);
    expect(getAddon("website_design")!.fromPrice).toBe(true);
    expect(getAddon("website_design")!.billing).toBe("oneoff");
    expect(getAddon("smart_inventory")!.amount).toBe(199);
    expect(getAddon("smart_inventory")!.comingSoon).toBe(true);
  });

  it("planAmount picks the right column per cycle", () => {
    const p = getPlan("premium")!;
    expect(planAmount(p, "monthly")).toBe(399);
    expect(planAmount(p, "yearly")).toBe(3990);
  });

  it("formatEur renders whole euros with a thousands separator, no cents", () => {
    expect(formatEur(399)).toBe("€399");
    expect(formatEur(3990)).toBe("€3990".replace("3990", (3990).toLocaleString("es-ES")));
    expect(formatEur(750)).toBe("€750");
  });

  it("there are exactly two plans and four add-ons (voice split into two tiers, no website care)", () => {
    expect(PLANS.map((p) => p.id).sort()).toEqual(["business", "premium"]);
    expect(ADDONS.map((a) => a.id).sort()).toEqual([
      "smart_inventory",
      "voice_retell",
      "voice_vapi",
      "website_design",
    ]);
  });
});

describe("provider id resolution reads env, undefined when unset", () => {
  const KEYS = [
    "STRIPE_PRICE_PREMIUM_MONTHLY",
    "STRIPE_PRICE_BUSINESS_YEARLY",
    "STRIPE_PRICE_ADDON_VOICE_RETELL",
    "STRIPE_PRICE_ADDON_VOICE_RETELL_YEARLY",
    "PAYPAL_PLAN_PREMIUM_MONTHLY",
    "PAYPAL_PLAN_ADDON_WEBSITE_DESIGN",
  ];
  afterEach(() => {
    KEYS.forEach((k) => delete process.env[k]);
  });

  it("returns undefined when the env var is missing (so checkout 503s cleanly)", () => {
    expect(resolveStripePriceId("premium", "monthly")).toBeUndefined();
    expect(resolvePaypalPlanId("premium", "monthly")).toBeUndefined();
    expect(resolveStripePriceId("voice_retell")).toBeUndefined();
  });

  it("maps plan + cycle to the predictable env var name", () => {
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_abc";
    process.env.STRIPE_PRICE_BUSINESS_YEARLY = "price_def";
    process.env.PAYPAL_PLAN_PREMIUM_MONTHLY = "P-123";
    expect(resolveStripePriceId("premium", "monthly")).toBe("price_abc");
    expect(resolveStripePriceId("business", "yearly")).toBe("price_def");
    expect(resolvePaypalPlanId("premium", "monthly")).toBe("P-123");
  });

  it("maps add-ons via the ADDON_ env prefix", () => {
    process.env.STRIPE_PRICE_ADDON_VOICE_RETELL = "price_voice";
    process.env.PAYPAL_PLAN_ADDON_WEBSITE_DESIGN = "P-design";
    expect(resolveStripePriceId("voice_retell")).toBe("price_voice");
    expect(resolvePaypalPlanId("website_design")).toBe("P-design");
  });

  it("yearly bundle picks the add-on's YEARLY price (Stripe can't mix intervals)", () => {
    process.env.STRIPE_PRICE_ADDON_VOICE_RETELL = "price_voice_monthly";
    process.env.STRIPE_PRICE_ADDON_VOICE_RETELL_YEARLY = "price_voice_yearly";
    // monthly cycle → monthly add-on price; yearly cycle → yearly add-on price.
    expect(resolveStripePriceId("voice_retell", "monthly")).toBe("price_voice_monthly");
    expect(resolveStripePriceId("voice_retell", "yearly")).toBe("price_voice_yearly");
    // no-cycle (standalone add-on checkout) still resolves the monthly price.
    expect(resolveStripePriceId("voice_retell")).toBe("price_voice_monthly");
  });

  it("falls back to the monthly add-on price when no yearly one is set", () => {
    process.env.STRIPE_PRICE_ADDON_VOICE_RETELL = "price_voice_monthly";
    // the route guards the yearly-bundle mismatch separately; the resolver itself
    // never returns undefined just because the yearly price is missing.
    expect(resolveStripePriceId("voice_retell", "yearly")).toBe("price_voice_monthly");
  });
});

describe("billing catalog — bundle (pay everything together)", () => {
  it("only recurring, non-coming-soon add-ons are bundleable", () => {
    const ids = bundleableAddons().map((a) => a.id);
    // both voice tiers are recurring; website_design is one-off; smart_inventory is coming soon.
    expect(ids).toContain("voice_vapi");
    expect(ids).toContain("voice_retell");
    expect(ids).not.toContain("website_design");
    expect(ids).not.toContain("smart_inventory");
  });

  it("monthly bundle = plan + sum of monthly add-on prices", () => {
    const premium = getPlan("premium")!;
    // 399 + voice_retell 199 = 598
    expect(bundleTotal(premium, "monthly", ["voice_retell"])).toBe(598);
  });

  it("yearly bundle bills add-ons ×10 (2 months free, matching the plan)", () => {
    const premium = getPlan("premium")!;
    // 3990 + voice_retell 199×10 = 3990 + 1990 = 5980
    expect(bundleTotal(premium, "yearly", ["voice_retell"])).toBe(5980);
  });

  it("ignores one-off / coming-soon / unknown ids in the total", () => {
    const business = getPlan("business")!;
    // website_design (one-off) and smart_inventory (coming soon) contribute nothing.
    expect(bundleTotal(business, "monthly", ["website_design", "smart_inventory"])).toBe(business.monthly);
  });

  it("an empty add-on list yields just the plan price", () => {
    const premium = getPlan("premium")!;
    expect(bundleTotal(premium, "monthly", [])).toBe(premium.monthly);
  });
});
