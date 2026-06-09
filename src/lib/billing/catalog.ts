// Billing catalog — the single source of truth for what a restaurant can buy and
// what it costs. Mirrors the public pricing page (restaurants.baliflowagency.com):
// two main subscription plans (Premium, Business) billed monthly OR yearly (yearly
// = 2 months free), plus optional add-ons sold on top of a plan. Prices live here
// as DATA so the PaymentsTab, the checkout routes and any invoice copy all read
// the same numbers — change a price in one place.
//
// Stripe/PayPal mapping: each price has a `stripePriceId` and `paypalPlanId` slot
// resolved from env at runtime (NOT hard-coded here — the live ids only exist once
// the Stripe/PayPal products are created). `resolveStripePriceId` / `resolvePaypalPlanId`
// read the matching env var; checkout refuses cleanly when it's unset.

export type PlanId = "premium" | "business";
export type AddonId = "voice_agent" | "website_care" | "website_design" | "smart_inventory";
export type BillingCycle = "monthly" | "yearly";

/** A single purchasable subscription plan. Amounts are in EUR, whole euros (the
 * public page shows no cents). `yearly` is the once-a-year charge (2 months free
 * vs 12× monthly). */
export interface Plan {
  id: PlanId;
  /** i18n key for the display name (falls back to `name`). */
  nameKey: string;
  name: string;
  /** i18n key for the one-line tagline. */
  taglineKey: string;
  monthly: number;
  yearly: number;
  /** i18n keys for the bullet list of what's included. */
  featureKeys: string[];
  /** Marks the plan the page highlights as the default recommendation. */
  highlighted?: boolean;
}

/** An optional extra sold alongside a plan. `recurring` add-ons are monthly
 * subscriptions; `oneoff` is a single charge (website design). `comingSoon`
 * renders the card disabled with a "coming soon" note (smart inventory). */
export interface Addon {
  id: AddonId;
  nameKey: string;
  name: string;
  descKey: string;
  amount: number;
  billing: "recurring" | "oneoff";
  /** For recurring add-ons, the period of `amount`. One-offs ignore this. */
  period?: "monthly";
  /** "from €750" style — the amount is a starting price, not fixed. */
  fromPrice?: boolean;
  comingSoon?: boolean;
}

export const CURRENCY = "EUR" as const;

export const PLANS: Plan[] = [
  {
    id: "premium",
    nameKey: "billing_plan_premium",
    name: "Premium",
    taglineKey: "billing_plan_premium_tagline",
    monthly: 399,
    yearly: 3990, // 2 months free vs 12×399
    highlighted: true,
    featureKeys: [
      "billing_feat_whatsapp_assistant",
      "billing_feat_faqs",
      "billing_feat_secretary",
      "billing_feat_crm",
      "billing_feat_customer_db",
      "billing_feat_reminders",
      "billing_feat_reviews",
      "billing_feat_smart_menu",
      "billing_feat_floor_plan",
      "billing_feat_analytics",
      "billing_feat_priority_support",
    ],
  },
  {
    id: "business",
    nameKey: "billing_plan_business",
    name: "Business",
    taglineKey: "billing_plan_business_tagline",
    monthly: 329,
    yearly: 3290,
    featureKeys: [
      "billing_feat_everything_premium",
      "billing_feat_multilocal_panel",
      "billing_feat_central_db",
      "billing_feat_comparative_analytics",
      "billing_feat_coordinated_rollout",
      "billing_feat_account_manager",
    ],
  },
];

export const ADDONS: Addon[] = [
  {
    id: "website_design",
    nameKey: "billing_addon_website_design",
    name: "Diseño Web",
    descKey: "billing_addon_website_design_desc",
    amount: 750,
    billing: "oneoff",
    fromPrice: true,
  },
  {
    id: "website_care",
    nameKey: "billing_addon_website_care",
    name: "Cuidado del Sitio Web",
    descKey: "billing_addon_website_care_desc",
    amount: 59,
    billing: "recurring",
    period: "monthly",
  },
  {
    id: "voice_agent",
    nameKey: "billing_addon_voice_agent",
    name: "Agente de voz IA",
    descKey: "billing_addon_voice_agent_desc",
    amount: 199,
    billing: "recurring",
    period: "monthly",
  },
  {
    id: "smart_inventory",
    nameKey: "billing_addon_smart_inventory",
    name: "Inventario inteligente",
    descKey: "billing_addon_smart_inventory_desc",
    amount: 199,
    billing: "recurring",
    period: "monthly",
    comingSoon: true,
  },
];

export function getPlan(id: PlanId): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function getAddon(id: AddonId): Addon | undefined {
  return ADDONS.find((a) => a.id === id);
}

/** The amount (EUR) charged for a plan at a given cycle. */
export function planAmount(plan: Plan, cycle: BillingCycle): number {
  return cycle === "yearly" ? plan.yearly : plan.monthly;
}

/** Format a whole-euro amount as "€399" (no cents — matches the public page). */
export function formatEur(amount: number): string {
  return `€${amount.toLocaleString("es-ES")}`;
}

// ---- Provider id resolution ------------------------------------------------
// The live Stripe price ids / PayPal plan ids only exist after the products are
// created in each dashboard. We read them from env so deploying the keys later is
// a config change, not a code change. Env naming is explicit and predictable:
//   STRIPE_PRICE_PREMIUM_MONTHLY, STRIPE_PRICE_PREMIUM_YEARLY,
//   STRIPE_PRICE_BUSINESS_MONTHLY, STRIPE_PRICE_BUSINESS_YEARLY,
//   STRIPE_PRICE_ADDON_VOICE_AGENT, STRIPE_PRICE_ADDON_WEBSITE_CARE,
//   STRIPE_PRICE_ADDON_WEBSITE_DESIGN, STRIPE_PRICE_ADDON_SMART_INVENTORY
//   PAYPAL_PLAN_PREMIUM_MONTHLY, … (same suffixes)

export function resolveStripePriceId(kind: PlanId | AddonId, cycle?: BillingCycle): string | undefined {
  const key = cycle
    ? `STRIPE_PRICE_${kind.toUpperCase()}_${cycle.toUpperCase()}`
    : `STRIPE_PRICE_ADDON_${kind.toUpperCase()}`;
  return process.env[key] || undefined;
}

export function resolvePaypalPlanId(kind: PlanId | AddonId, cycle?: BillingCycle): string | undefined {
  const key = cycle
    ? `PAYPAL_PLAN_${kind.toUpperCase()}_${cycle.toUpperCase()}`
    : `PAYPAL_PLAN_ADDON_${kind.toUpperCase()}`;
  return process.env[key] || undefined;
}
