import { describe, it, expect } from "vitest";
import { entitlementFor, hasAddon, hasManagement, GRACE_DAYS } from "./entitlements";
import { getFeatures, getRawFeatures } from "@/lib/types/tenant-settings";
import type { TenantSettings } from "@/lib/types/tenant-settings";

// The entitlement helper is the single gate for paid add-ons: get the grace /
// manual-override rules wrong here and a customer either keeps a feature they
// stopped paying for, or loses one they're still paying for. These cover every
// branch with an injected clock so the grace-window math is deterministic.

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now" so tests never depend on the wall clock.
const NOW = Date.parse("2026-06-09T12:00:00.000Z");
const at = (ms: number) => () => ms;

/** Build a settings object with a billing block for smart_inventory. */
function billing(over: Partial<NonNullable<TenantSettings["billing"]>> = {}): TenantSettings {
  return { billing: { addons: ["smart_inventory"], status: "active", ...over } };
}

describe("entitlementFor — manual override (feature flag) wins", () => {
  it("management_enabled:true unlocks even with NO subscription", () => {
    const s: TenantSettings = { features: { management_enabled: true } };
    const e = entitlementFor(s, "smart_inventory", at(NOW));
    expect(e.active).toBe(true);
    expect(e.reason).toBe("manual");
  });

  it("management_enabled:true unlocks even when the subscription is canceled", () => {
    const s: TenantSettings = {
      features: { management_enabled: true },
      billing: { addons: ["smart_inventory"], status: "canceled" },
    };
    expect(hasManagement(s, at(NOW))).toBe(true);
  });
});

describe("entitlementFor — paid & active", () => {
  it("active subscription with the add-on → unlocked", () => {
    const e = entitlementFor(billing({ status: "active" }), "smart_inventory", at(NOW));
    expect(e.active).toBe(true);
    expect(e.reason).toBe("active");
  });

  it("trialing counts as active", () => {
    expect(hasAddon(billing({ status: "trialing" }), "smart_inventory", at(NOW))).toBe(true);
  });

  it("active plan but add-on NOT purchased → locked", () => {
    const s = billing({ addons: [], status: "active" });
    const e = entitlementFor(s, "smart_inventory", at(NOW));
    expect(e.active).toBe(false);
    expect(e.reason).toBe("none");
  });
});

describe("entitlementFor — past_due grace window", () => {
  const periodEnd = new Date(NOW).toISOString(); // period ended exactly now

  it("inside the 7-day grace → still unlocked, reason grace", () => {
    const s = billing({ status: "past_due", current_period_end: periodEnd });
    // 3 days after period end — within grace.
    const e = entitlementFor(s, "smart_inventory", at(NOW + 3 * DAY));
    expect(e.active).toBe(true);
    expect(e.reason).toBe("grace");
    expect(e.graceEndsAt).toBe(new Date(NOW + GRACE_DAYS * DAY).toISOString());
  });

  it("exactly at the grace boundary → still unlocked", () => {
    const s = billing({ status: "past_due", current_period_end: periodEnd });
    const e = entitlementFor(s, "smart_inventory", at(NOW + GRACE_DAYS * DAY));
    expect(e.active).toBe(true);
    expect(e.reason).toBe("grace");
  });

  it("one day past the grace window → locked, reason expired", () => {
    const s = billing({ status: "past_due", current_period_end: periodEnd });
    const e = entitlementFor(s, "smart_inventory", at(NOW + (GRACE_DAYS + 1) * DAY));
    expect(e.active).toBe(false);
    expect(e.reason).toBe("expired");
  });

  it("past_due with no period_end recorded → lenient (still unlocked)", () => {
    const s = billing({ status: "past_due", current_period_end: undefined });
    const e = entitlementFor(s, "smart_inventory", at(NOW + 999 * DAY));
    expect(e.active).toBe(true);
    expect(e.reason).toBe("grace");
    expect(e.graceEndsAt).toBeUndefined();
  });
});

describe("entitlementFor — locked states", () => {
  it("canceled → locked, reason canceled", () => {
    const e = entitlementFor(billing({ status: "canceled" }), "smart_inventory", at(NOW));
    expect(e.active).toBe(false);
    expect(e.reason).toBe("canceled");
  });

  it("no billing at all → locked, reason none", () => {
    const e = entitlementFor({}, "smart_inventory", at(NOW));
    expect(e.active).toBe(false);
    expect(e.reason).toBe("none");
  });

  it("null settings → locked, never throws", () => {
    expect(hasAddon(null, "smart_inventory", at(NOW))).toBe(false);
    expect(hasManagement(undefined, at(NOW))).toBe(false);
  });
});

// The raw-vs-derived split is what stops a paying tenant's access from leaking
// into the manual-override flag (and a client from self-enabling for free). These
// pin that invariant: getFeatures DERIVES management_enabled from billing;
// getRawFeatures reflects ONLY the stored flag.
describe("getFeatures vs getRawFeatures — management_enabled derivation", () => {
  it("paid+active add-on → getFeatures derives management_enabled true, raw stays false", () => {
    const s: TenantSettings = { billing: { addons: ["smart_inventory"], status: "active" }, features: {} };
    expect(getFeatures(s).management_enabled).toBe(true);
    expect(getRawFeatures(s).management_enabled).toBe(false);
  });

  it("manual override (raw flag) → both true", () => {
    const s: TenantSettings = { features: { management_enabled: true } };
    expect(getFeatures(s).management_enabled).toBe(true);
    expect(getRawFeatures(s).management_enabled).toBe(true);
  });

  it("no add-on, no flag → both false", () => {
    const s: TenantSettings = { features: {} };
    expect(getFeatures(s).management_enabled).toBe(false);
    expect(getRawFeatures(s).management_enabled).toBe(false);
  });

  it("other flags are identical between the two (only management differs)", () => {
    const s: TenantSettings = { features: { waitlist_enabled: false, terrace: true } };
    const d = getFeatures(s);
    const r = getRawFeatures(s);
    expect(d.waitlist_enabled).toBe(r.waitlist_enabled);
    expect(d.terrace).toBe(r.terrace);
    expect(d.reminders_enabled).toBe(r.reminders_enabled);
  });
});
