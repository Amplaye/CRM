import { describe, it, expect, afterEach } from "vitest";
import {
  PLANS,
  ADDONS,
  getPlan,
  getAddon,
  planAmount,
  formatEur,
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

  it("add-on prices: voice €199/mo, website care €59/mo, design from €750, inventory €199/mo", () => {
    expect(getAddon("voice_agent")!.amount).toBe(199);
    expect(getAddon("website_care")!.amount).toBe(59);
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

  it("there are exactly two plans and four add-ons", () => {
    expect(PLANS.map((p) => p.id).sort()).toEqual(["business", "premium"]);
    expect(ADDONS.map((a) => a.id).sort()).toEqual([
      "smart_inventory",
      "voice_agent",
      "website_care",
      "website_design",
    ]);
  });
});

describe("provider id resolution reads env, undefined when unset", () => {
  const KEYS = [
    "STRIPE_PRICE_PREMIUM_MONTHLY",
    "STRIPE_PRICE_BUSINESS_YEARLY",
    "STRIPE_PRICE_ADDON_VOICE_AGENT",
    "PAYPAL_PLAN_PREMIUM_MONTHLY",
    "PAYPAL_PLAN_ADDON_WEBSITE_CARE",
  ];
  afterEach(() => {
    KEYS.forEach((k) => delete process.env[k]);
  });

  it("returns undefined when the env var is missing (so checkout 503s cleanly)", () => {
    expect(resolveStripePriceId("premium", "monthly")).toBeUndefined();
    expect(resolvePaypalPlanId("premium", "monthly")).toBeUndefined();
    expect(resolveStripePriceId("voice_agent")).toBeUndefined();
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
    process.env.STRIPE_PRICE_ADDON_VOICE_AGENT = "price_voice";
    process.env.PAYPAL_PLAN_ADDON_WEBSITE_CARE = "P-care";
    expect(resolveStripePriceId("voice_agent")).toBe("price_voice");
    expect(resolvePaypalPlanId("website_care")).toBe("P-care");
  });
});
