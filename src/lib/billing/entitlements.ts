// Entitlements — the SINGLE source of truth for "is this paid feature unlocked
// for this tenant right now?". Everything that gates a paid module (the sidebar,
// the page guards, the API routes) asks this and nothing else, so the unlock /
// re-lock rules live in exactly one place.
//
// How a feature unlocks, in order of precedence:
//   1. MANUAL OVERRIDE — the matching feature flag in settings.features is true.
//      This is the admin's escape hatch (free trial, gift, or a fallback when the
//      automatic billing path has a hiccup). It wins over everything: if the flag
//      is on, the feature is on, full stop. See addManual()/management toggle.
//   2. PAID & ACTIVE — the add-on id is in settings.billing.addons AND the
//      subscription status is active/trialing.
//   3. GRACE — the add-on was paid but the last renewal failed (status past_due).
//      We keep it unlocked for GRACE_DAYS (7) past current_period_end so a
//      temporarily-declined card doesn't lock out a paying customer mid-month.
//      After the grace window, or once the status is canceled, it re-locks.
//
// The provider webhooks never delete the add-on id when a payment fails — they
// only move `status`/`current_period_end`. Keeping the id means a customer who
// pays the failed invoice is instantly back without re-purchasing; this helper is
// what turns that raw state into a yes/no, grace window included.

import type { TenantSettings, TenantFeatures } from "@/lib/types/tenant-settings";
import type { AddonId } from "./catalog";

// Read the RAW manual-override flag straight off settings, NOT through
// getFeatures(): getFeatures() now derives `management_enabled` partly FROM this
// module (paid add-on → flag on), so importing it back here would be circular.
// The override is "did a human explicitly tick the flag in settings.features",
// which is exactly the stored boolean.

/** Days a past_due subscription stays unlocked past its period end before we
 * re-lock the feature. A declined card shouldn't kill access on the first retry. */
export const GRACE_DAYS = 7;

/** Add-ons that gate a CRM feature, paired with the feature flag that both
 * (a) lets the admin unlock the feature by hand and (b) is what the rest of the
 * app already checks today. The add-on is the PAID path to flipping that flag on;
 * the flag itself is the manual override. Add a row here when a new paid module
 * lands — this map is the only place that knows add-on ⇄ feature.
 *
 * `smart_inventory` IS the POS / management module (controllo gestione): POS
 * sales, food cost, P&L, inventory, invoices. Buying it unlocks `management_enabled`. */
export const ADDON_FEATURE: Partial<Record<AddonId, keyof TenantFeatures>> = {
  smart_inventory: "management_enabled",
};

/** Why an add-on is (un)locked — useful for the UI to show the right message
 * (e.g. a "your payment failed, update your card" banner during grace). */
export type EntitlementReason =
  | "manual"   // unlocked by the manual feature-flag override
  | "active"   // unlocked by an active/trialing paid subscription
  | "grace"    // paid but payment failed; still unlocked inside the grace window
  | "expired"  // grace window passed → locked
  | "canceled" // subscription canceled → locked
  | "none";    // never purchased and no manual override → locked

export interface Entitlement {
  /** The bottom line: is the feature usable right now? */
  active: boolean;
  reason: EntitlementReason;
  /** When in grace, the ISO instant access is lost (period end + GRACE_DAYS). */
  graceEndsAt?: string;
}

/** Now, injectable for tests. Defaults to the real clock. */
type Clock = () => number;
const realNow: Clock = () => Date.now();

/** The past-due grace-window math, shared by the add-on gate (entitlementFor) and
 * the plan gate (hasActivePlan). Given a billing block, returns whether `now` is
 * still inside the GRACE_DAYS window after current_period_end, plus the computed
 * grace-end instant. A missing/unparseable period end is treated leniently as
 * Infinity (still in grace) — the webhook will stamp a concrete date on its next
 * event, and we'd rather not lock out a paying customer over a missing field. */
function inGrace(
  billing: TenantSettings["billing"],
  now: number,
): { within: boolean; graceEnd: number } {
  const periodEnd = billing?.current_period_end ? Date.parse(billing.current_period_end) : NaN;
  const graceEnd = Number.isNaN(periodEnd) ? Infinity : periodEnd + GRACE_DAYS * 24 * 60 * 60 * 1000;
  return { within: now <= graceEnd, graceEnd };
}

/**
 * Resolve whether a paid add-on is currently unlocked for a tenant, with the
 * grace + manual-override rules applied. Pure function of the tenant's settings
 * (the cheap mirror the webhooks keep in sync) — no DB call, so it's safe to use
 * in both server guards and client rendering off the same settings object.
 */
export function entitlementFor(
  settings: TenantSettings | null | undefined,
  addon: AddonId,
  now: Clock = realNow,
): Entitlement {
  // 1. Manual override — the raw feature flag wins over any billing state.
  const flagKey = ADDON_FEATURE[addon];
  if (flagKey && settings?.features?.[flagKey] === true) {
    return { active: true, reason: "manual" };
  }

  const billing = settings?.billing;
  const owns = !!billing?.addons?.includes(addon);
  if (!owns) return { active: false, reason: "none" };

  const status = billing?.status;

  // 2. Paid & active (or trialing) → unlocked.
  if (status === "active" || status === "trialing") {
    return { active: true, reason: "active" };
  }

  // 3. Past-due → grace window past the period end.
  if (status === "past_due") {
    const { within, graceEnd } = inGrace(billing, now());
    if (within) {
      return {
        active: true,
        reason: "grace",
        graceEndsAt: Number.isFinite(graceEnd) ? new Date(graceEnd).toISOString() : undefined,
      };
    }
    return { active: false, reason: "expired" };
  }

  // canceled / incomplete / anything else → locked.
  return { active: false, reason: status === "canceled" ? "canceled" : "none" };
}

/** Convenience boolean for the common "can this tenant use the add-on?" check. */
export function hasAddon(
  settings: TenantSettings | null | undefined,
  addon: AddonId,
  now: Clock = realNow,
): boolean {
  return entitlementFor(settings, addon, now).active;
}

/** Does the tenant have the POS / management (controllo gestione) module unlocked?
 * Thin wrapper so call sites read intent, not the add-on id. */
export function hasManagement(
  settings: TenantSettings | null | undefined,
  now: Clock = realNow,
): boolean {
  return hasAddon(settings, "smart_inventory", now);
}

/** Does the tenant have an ACTIVE paid plan (premium or business) right now?
 *
 * This is the PLAN-level gate that opens the core CRM (analytics, reservations,
 * floor, waitlist, pending, guests, conversations, knowledge). It mirrors the
 * billing branch of entitlementFor but keys on the subscription itself
 * (`billing.plan`) instead of an add-on id:
 *   - no plan recorded             → false (entry-package tenant: menu + settings only)
 *   - active / trialing            → true
 *   - past_due inside grace window → true (declined card, same 7-day leniency)
 *   - canceled / incomplete / else → false
 *
 * Deliberately standalone (NOT folded into getFeatures): the plan gate is
 * cross-cutting — it locks many sections at once — so it isn't a TenantFeatures
 * flag, and it must stay orthogonal to the management add-on gate (a Business
 * tenant without smart_inventory must still see the gestionale as add-on-locked,
 * not unlocked). Page guards use this for a cosmetic lock; the real protection is
 * the matching API 403s + RLS (tenant_has_active_plan). */
export function hasActivePlan(
  settings: TenantSettings | null | undefined,
  now: Clock = realNow,
): boolean {
  const billing = settings?.billing;
  if (!billing?.plan) return false;
  const status = billing.status;
  if (status === "active" || status === "trialing") return true;
  if (status === "past_due") return inGrace(billing, now()).within;
  return false;
}
