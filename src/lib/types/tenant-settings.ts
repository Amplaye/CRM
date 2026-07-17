// Feature flags + typed tenant settings.
import type { TenantStatus } from "@/lib/tenants/status";
// `management_enabled` is gated by the smart_inventory paid add-on; getFeatures()
// derives its effective value via this helper. entitlements.ts only reads the RAW
// settings.features flag (the manual override), so there is no import cycle.
import { hasManagement } from "@/lib/billing/entitlements";
//
// SaaS principle (see docs/PIANO_SAAS.md, Mossa 3): a restaurant's differences
// live as DATA here — config, never forked code. Adding a new capability means
// adding ONE flag to this template; every future tenant then has it for free.
// The matching "is this variant finite?" log lives in docs/REGISTRO_VARIANTI.md.

/** Voice tier. `vapi` = base (default, every tenant); `retell` = premium upgrade. */
export type VoiceProviderTier = "vapi" | "retell";

/** The sections the public micro-site (/s/<slug>) can show, in canonical order.
 * `site_branding.sections` stores the owner's enabled subset + order; the hero
 * is always shown and isn't in this list. */
export const SITE_SECTIONS = ["about", "menu", "gallery", "reviews", "hours", "contact"] as const;
export type SiteSectionKey = (typeof SITE_SECTIONS)[number];

/** Visual templates for the public micro-site /s/<slug>. `classic` is the
 * original built-in design (assembled with the form fields of the Website
 * dashboard). Every other key replicates one of the agency demo sites and is
 * edited INLINE in the visual editor (/website/editor): each text and image
 * block has an id, owner overrides live in `site_content[template]`, and each
 * template embeds the CRM booking widget. Sections are full-bleed by design. */
export const SITE_TEMPLATES = [
  "classic",
  "suerte",
  "dolcevita",
  "champinoneria",
  "picnic",
  "perezbeers",
  "vasco",
  "montesdeoca",
] as const;
export type SiteTemplateKey = (typeof SITE_TEMPLATES)[number];

/** On/off capabilities a single restaurant can have. Plain, owner-answerable. */
export interface TenantFeatures {
  waitlist_enabled: boolean; // collect guests when full, notify on free table
  multi_room: boolean;       // separate rooms / areas
  double_shift: boolean;     // open for both lunch and dinner
  multi_language: boolean;   // bot answers guests in several languages
  events_enabled: boolean;   // special nights / private events / large groups
  terrace: boolean;          // outdoor seating
  pet_friendly: boolean;     // pets allowed
  reminders_enabled: boolean; // send the day-before booking reminder (WhatsApp template)
  followup_enabled: boolean;  // send the post-visit thank-you / review request (WhatsApp template)
  commercial_info_enabled: boolean; // bot answers commercial questions (price lists, set menus, buffets, cakes) from `commerciale` KB articles + proactively offers them
  management_enabled: boolean; // iammi-style controllo gestione (POS sales, food cost, P&L, inventory, invoices)
  self_order_enabled: boolean; // QR self-ordering at the table: /m/<slug>?table=<id> lets guests send draft lines to the native cassa
  qr_pay_enabled: boolean;     // pay-at-table: the same table QR lets guests view + pay their cassa bill on the TENANT'S OWN Stripe (BYO key in payment_secrets)
  deposits_enabled: boolean;   // real Stripe deposits on bookings (link to pay, no-show forfeiture)
  reviews_enabled: boolean;    // certified in-house reviews: /r/<slug> collects rating+comment before Google
  marketing_enabled: boolean;  // campaigns to guest segments via email/WhatsApp/SMS
  website_enabled: boolean;    // public template micro-site at /s/<slug>
  gift_cards_enabled: boolean; // sell + redeem gift vouchers (public /g/<slug> + cassa redemption)
  loyalty_enabled: boolean;    // points/rewards per visit or spend
  social_enabled: boolean;     // Instagram/Facebook: AI-drafted posts (image/carousel/reel via Remotion), human-approved, cron-published via Meta Graph
  fiscal_enabled: boolean;     // Spain/VeriFactu: the cassa is a SIF — it chains and files every ticket with AEAT
}

/** Sensible defaults for an average restaurant. Chosen so existing tenants keep
 * today's behaviour: waitlist/double-shift/multi-language stay ON, the rest OFF
 * until an owner opts in. Reminders default ON (cheap UTILITY template, expected
 * by guests); the post-visit follow-up defaults OFF (it's a MARKETING template —
 * opt-in only, so we never message promotionally without the owner's choice). */
export const DEFAULT_FEATURES: TenantFeatures = {
  waitlist_enabled: true,
  multi_room: false,
  double_shift: true,
  multi_language: true,
  events_enabled: false,
  terrace: false,
  pet_friendly: false,
  reminders_enabled: true,
  followup_enabled: false,
  // OFF by default: a free self-serve module the owner opts into. When ON, the bot
  // answers commercial questions (cake price list, set menus, buffets, dish lists)
  // from the tenant's `commerciale` KB articles and proactively offers them on
  // group/occasion/vague-intent signals. No commercial article is exposed to the
  // bot while this is OFF (gated server-side in /api/ai/restaurant-info).
  commercial_info_enabled: false,
  // OFF by default: financial management is an opt-in module an owner enables
  // (it surfaces POS/food-cost/inventory screens that only matter once a till is
  // connected — today the MockAdapter — and recipes/costs are entered).
  management_enabled: false,
  // OFF by default: table QR ordering writes into the native cassa, so it only
  // makes sense once the owner uses /cassa and has printed the per-table QRs.
  self_order_enabled: false,
  // OFF by default: paying the bill from the table QR needs the venue's own
  // Stripe key first (Settings → Pagamenti) — without it every attempt would
  // dead-end at "no_stripe".
  qr_pay_enabled: false,
  // All-inclusive front-of-house modules (plan "7 funzioni", 2026-07). Core
  // features unlocked by the plan — NOT paid add-ons — but each defaults OFF
  // because it needs owner setup first (Stripe amounts, review link, verified
  // email domain, site content, voucher T&Cs, points rules).
  deposits_enabled: false,
  reviews_enabled: false,
  marketing_enabled: false,
  website_enabled: false,
  gift_cards_enabled: false,
  loyalty_enabled: false,
  // OFF by default: needs a Meta connection (Instagram Business + Facebook Page)
  // before it can do anything. An owner opts in, then connects the account in the
  // Social section; until the token exists, the composer works but publishing can't.
  social_enabled: false,
  // OFF by default, and NOT in FEATURE_FLAGS below — a client must never be able to
  // switch this on themselves. Flipping it turns their till into a SIF: every ticket
  // gets chained and filed with the Agencia Tributaria under their NIF, and the till
  // starts REFUSING payments when the fiscal identity isn't configured. That is a
  // decision that follows a signed representation mandate, not a toggle.
  fiscal_enabled: false,
};

/** Ordered list driving the client-facing Settings → Funzionalità UI (label/hint
 * via i18n keys). `management_enabled` is deliberately ABSENT: it's a paid add-on,
 * not a free self-serve toggle. Owners unlock the gestionale by buying the add-on
 * (or we enable it for them via the admin manual override) — never by flipping a
 * switch in their own settings. Keeping it out of this list is what stops a client
 * from turning the paid module on for free.
 *
 * `fiscal_enabled` is ABSENT for the same structural reason and a heavier one: it
 * makes the till a fiscal system filing under the client's NIF. It is turned on
 * from Settings → Fiscale, and only once the obligado and the signed mandate exist. */
export const FEATURE_FLAGS: ReadonlyArray<{ key: keyof TenantFeatures; labelKey: string; hintKey: string }> = [
  { key: "waitlist_enabled", labelKey: "settings_feature_waitlist", hintKey: "settings_feature_waitlist_hint" },
  { key: "double_shift", labelKey: "settings_feature_double_shift", hintKey: "settings_feature_double_shift_hint" },
  { key: "multi_room", labelKey: "settings_feature_multi_room", hintKey: "settings_feature_multi_room_hint" },
  { key: "multi_language", labelKey: "settings_feature_multi_language", hintKey: "settings_feature_multi_language_hint" },
  { key: "events_enabled", labelKey: "settings_feature_events", hintKey: "settings_feature_events_hint" },
  { key: "terrace", labelKey: "settings_feature_terrace", hintKey: "settings_feature_terrace_hint" },
  { key: "pet_friendly", labelKey: "settings_feature_pet_friendly", hintKey: "settings_feature_pet_friendly_hint" },
  { key: "reminders_enabled", labelKey: "settings_feature_reminders", hintKey: "settings_feature_reminders_hint" },
  { key: "followup_enabled", labelKey: "settings_feature_followup", hintKey: "settings_feature_followup_hint" },
  { key: "commercial_info_enabled", labelKey: "settings_feature_commercial_info", hintKey: "settings_feature_commercial_info_hint" },
  { key: "self_order_enabled", labelKey: "settings_feature_self_order", hintKey: "settings_feature_self_order_hint" },
  { key: "qr_pay_enabled", labelKey: "settings_feature_qr_pay", hintKey: "settings_feature_qr_pay_hint" },
  { key: "deposits_enabled", labelKey: "settings_feature_deposits", hintKey: "settings_feature_deposits_hint" },
  { key: "reviews_enabled", labelKey: "settings_feature_reviews", hintKey: "settings_feature_reviews_hint" },
  { key: "marketing_enabled", labelKey: "settings_feature_marketing", hintKey: "settings_feature_marketing_hint" },
  { key: "website_enabled", labelKey: "settings_feature_website", hintKey: "settings_feature_website_hint" },
  { key: "gift_cards_enabled", labelKey: "settings_feature_gift_cards", hintKey: "settings_feature_gift_cards_hint" },
  { key: "loyalty_enabled", labelKey: "settings_feature_loyalty", hintKey: "settings_feature_loyalty_hint" },
  { key: "social_enabled", labelKey: "settings_feature_social", hintKey: "settings_feature_social_hint" },
];

/**
 * Typed shape of `tenants.settings` (JSONB). Known fields are listed for help/
 * autocomplete; the index signature keeps backward compatibility with the many
 * call sites that still read settings via `(settings as any).foo`.
 */
export interface TenantSettings {
  timezone?: string;
  /** Voice/assistant locale, e.g. "es-ES" — drives the voice prompt FECHA header
   * and date formatting. Derived from the PRIMARY assistant language. */
  locale?: string;
  /** CRM dashboard UI language (a bare code: "es" | "it" | "en" | "de").
   * Independent of `locale`/the assistant — chosen once at onboarding and read
   * at app boot to fix the dashboard language (there is no in-app switcher). */
  crm_locale?: "es" | "it" | "en" | "de";
  /** Public-menu template shown on /m/<slug>: "1" Immersive · "2" Editorial ·
   * "3" Cinematic · "4" Classic. Chosen by the owner in the menu editor;
   * defaults to "1" when unset. ?style= on the public URL is a preview override. */
  menu_style?: "1" | "2" | "3" | "4";
  currency?: string;
  ai_enabled_channels?: string[];
  features?: Partial<TenantFeatures>;
  /** Per-tenant WhatsApp channel config. `from` is the tenant's own sender
   * number (e.g. "whatsapp:+34..."); unset → platform default. Resolved in one
   * place by src/lib/whatsapp/from.ts (Mossa 5: sending number is config, not code). */
  whatsapp?: { from?: string };
  /** Per-tenant EMAIL sender config (Marketing → mittente). Only the display name
   *  the guest sees ("Ristorante Picnic") lives here. The technical address does
   *  NOT: it comes from the tenant's own Resend account (email_secrets.from_address,
   *  on a domain that account has DNS-verified), because an ESP refuses to send
   *  from a domain it hasn't verified — and every CRM email now goes out on the
   *  tenant's own key, never a shared platform one. A key is also a secret and
   *  settings are browser-readable, which is the other reason it isn't here.
   *  Campaigns are send-only: no Reply-To. Resolved by src/lib/email/from.ts. */
  marketing_email?: { sender_name?: string };
  /** Which POS adapter feeds the canonical pos_sales tables. `mock` (default)
   * generates realistic fake sales; the real tills drop in later. Resolved in one
   * place by src/lib/pos/pos-provider.ts (same single-resolution-point idiom as
   * `voice.provider`). Credentials never live here — they go encrypted in the
   * dedicated pos_credentials table (a browser can read settings; secrets can't).
   * `declared` records the till brand the owner picked at onboarding even when the
   * active `provider` stays `mock` (its real adapter isn't shipped yet), so we know
   * which adapter to wire up when its API access arrives. */
  pos?: {
    provider?: "mock" | "cassa_in_cloud" | "tilby" | "ipratico" | "nempos" | "deliverect" | "loyverse";
    declared?: "none" | "cassa_in_cloud" | "tilby" | "ipratico" | "nempos" | "deliverect" | "loyverse";
  };
  /** Native cassa (built-in POS) preferences. `cover_charge` is the coperto per
   * person in €; each new bill snapshots it as cassa_orders.cover_unit, so a
   * price change never rewrites bills already open. Edited from the /cassa
   * screen (owner/manager) via /api/cassa/settings. */
  cassa?: { cover_charge?: number };
  /** Controllo-gestione preferences (Settings → Gestionale). Targets/budgets the
   * food-cost and P&L screens read; not policy the bot enforces. */
  management?: {
    /** Food-cost % above which a dish is flagged low-margin. Default 30. */
    food_cost_target_pct?: number;
    /** Monthly staff-cost budget, compared against entered labor_cost on the P&L. */
    labor_budget_monthly?: number;
    /** How a priced goods receipt updates an ingredient's cost: `last` (the most
     * recent price, the DB trigger default) or `avg` (weighted average over the
     * pre-receipt stock and the new goods). Default `last`. */
    cost_method?: "last" | "avg";
  };
  /** Per-restaurant branding shown in the CRM chrome. `logo_url` is a public URL
   * in the "branding" Storage bucket; when set, the sidebar uses it both top-left
   * (replacing the BaliFlow logo) and bottom-left (replacing the owner's initials
   * avatar). Unset → BaliFlow defaults. Uploaded/edited in Settings → General. */
  branding?: { logo_url?: string };
  /** Public-menu branding (Idea 2 — a FREE self-serve hook). Lets the owner brand
   * the hosted /m/<slug> menu independently of the CRM chrome: an accent colour
   * (cascaded into all 4 templates via the `--accent` CSS var), a display font, and
   * a menu logo. Distinct from `branding.logo_url` (the CRM-chrome logo): the menu
   * logo lives at the SEPARATE bucket path `${tenant.id}/menu-logo.webp`. All unset
   * → each template keeps its built-in palette/serif and shows no logo. Edited in
   * the menu dashboard; NOT plan-gated. */
  menu_branding?: {
    /** Accent colour as hex "#rrggbb". Overrides the template's primary accent. */
    brand_color?: string;
    /** Public URL of the menu logo in the "branding" bucket (menu-logo path). */
    logo_url?: string;
    /** Display serif for the menu wordmark/headings. Unset → Fraunces (default). */
    font?: "fraunces" | "playfair" | "cormorant";
  };
  /** Public micro-site branding/content for /s/<slug> (Fase 4 — website builder).
   * Same self-serve spirit as menu_branding but for the WHOLE site: the owner
   * edits it in the Website dashboard, zero code. `sections` is the ORDERED list
   * of enabled sections (unset → every section in the canonical order); hero and
   * gallery images live in the public "branding" bucket under the tenant folder
   * (`site-hero.webp`, `site-gallery-*.webp`). */
  site_branding?: {
    /** Which visual template renders /s/<slug>. Unset → "classic" (the
     * original design, so existing tenants keep today's site untouched). */
    template?: SiteTemplateKey;
    /** Public URL of the hero image (branding bucket, site-hero.webp). */
    hero_url?: string;
    /** Short line under the restaurant name in the hero. */
    tagline?: string;
    /** The "Chi siamo" prose shown in the About section. */
    about_text?: string;
    /** Accent colour as hex "#rrggbb" (falls back to menu_branding.brand_color). */
    brand_color?: string;
    /** Display serif for headings, same trio as the public menu. */
    font?: "fraunces" | "playfair" | "cormorant";
    /** Public URLs of gallery photos (branding bucket). */
    gallery?: string[];
    /** Ordered keys of the sections to show. Unset → all, canonical order.
     * Only the classic template consumes this; the demo-site templates have a
     * fixed structure and are edited inline instead. */
    sections?: SiteSectionKey[];
  };
  /** Inline-edited site content, keyed by template then by block id (e.g.
   * "hero.title" → text, "about.image" → public URL in the branding bucket).
   * Only OVERRIDES are stored — anything unset falls back to the template's
   * built-in default copy, so template updates flow to untouched blocks.
   * Content survives template switches (each template keeps its own map). */
  site_content?: Partial<Record<SiteTemplateKey, Record<string, string>>>;
  /** Per-template colour override: the editable "key" colours of each demo
   * template (background, text, surfaces, accents), as hex "#rrggbb", in the
   * registry `swatches` order. Unset → the template's built-in palette. The
   * first three slots keep their historical meaning (older 3-colour overrides
   * still resolve correctly); templates may expose more slots (c4, c5, …) so
   * every section can be recoloured. Stored per template so a scheme survives
   * template switches, like `site_content`. Rendered by cascading
   * `--c1..--cN` onto the wrapper; each template reads those vars with its own
   * hex as the fallback, so an unset palette is byte-identical to today. */
  site_palette?: Partial<Record<SiteTemplateKey, string[]>>;
  /** Gift-card DESIGNS — the sellable cards the owner composes in the Gift Cards
   * dashboard, rendered as-is on the public /g/<slug> page. Each entry is one
   * card: fixed amount + look (title, subtitle, colours or a photo). Absent or
   * empty → the public page falls back to the historical preset amounts, so a
   * tenant that never opens the editor keeps today's page. Shape + validation
   * live in src/lib/gift-cards/designs.ts (never read this array raw — go through
   * publishedGiftDesigns()). */
  gift_designs?: import("@/lib/gift-cards/designs").GiftDesign[];
  /** Loyalty programme config (Fase 6). Read via getLoyaltyConfig() which
   * applies defaults/clamping — points accrue on completed reservations,
   * rewards are redeemed by staff from the guest panel. */
  loyalty?: {
    points_per_visit?: number;
    reward_points?: number;
    reward_label?: string;
  };
  /** QR table self-ordering config (gated by features.self_order_enabled). The
   * flow lets guests send DRINKS instantly on scan but keeps FOOD locked for the
   * first few minutes of the table's visit, so a wave of tables doesn't flood the
   * kitchen at once. Read via getSelfOrderConfig(). The cooldown duration is a
   * fixed constant (owner's choice — no manual timer); only which menu categories
   * are "drinks" is configurable here, because item `station` is unset on these
   * venues so the system can't otherwise tell a mojito from a burger. */
  self_order?: {
    /** menu_categories.id values the owner flagged as drinks (phase-1, always
     * orderable). Everything not in a flagged category is food. */
    drink_category_ids?: string[];
  };
  /** Offboarding bookkeeping, written by the archive flow (src/lib/tenants/delete-tenant.ts). */
  archive?: { prev_status: TenantStatus; export_path?: string };
  /** Which voice platform serves this tenant's calls. Vapi is the BASE tier
   * (default for every tenant); Retell is the PREMIUM paid upgrade. Switching
   * tiers flips this flag — both providers run the SAME prompt (built from
   * voice-prompt.ts), so the switch is a routing change, not a rebuild. When the
   * flag is absent (legacy tenants written before tiering), getVoiceProvider
   * falls back to deducing it from which provider id is stored. */
  voice?: {
    provider?: VoiceProviderTier;
    /** Set by the billing → voice bridge (src/lib/billing/voice-billing.ts) when a
     * paid voice add-on flips the tier. `pending` = the flag is set but the target
     * provider's agent/number still has to be provisioned (clone/sync/number-buy,
     * done out-of-band by the reconcile job, never inline in the webhook); `active`
     * = the target provider already had an agent id, so the flip is fully live. */
    provisioning?: "pending" | "active";
  };
  /** Voice provider ids — both may be present (a premium tenant keeps its Vapi
   * clone so a downgrade back to base is instant). `voice.provider` decides which
   * one actually serves calls. */
  vapi?: { assistantId?: string };
  retell?: { agentId?: string; llmId?: string };
  retell_kb?: { id?: string };
  /** Persisted floor-plan zones (Sala → Plano editor). Zones used to be derived
   * purely from the tables' `zone` column, so a zone whose tables were all
   * deleted vanished forever. This array keeps a zone alive without tables and
   * stores per-zone decoration: `walls` (drawn dividers, in the same 600×560 px
   * canvas coordinate space as table positions) and `floor` (a floor-texture key
   * resolved client-side to a CSS background). Legacy tenants have this unset →
   * the UI falls back to table-derived zones, so nothing breaks. */
  floor_zones?: { name: string; walls?: { x1: number; y1: number; x2: number; y2: number }[]; floor?: string }[];
  /** Legacy: cloned n8n workflow ids, present on tenants provisioned before the
   * Cloudflare migration. No longer written (n8n is shut down); kept for reads. */
  n8n?: { workflow_ids?: string[] };
  /** Provisioning markers (see src/lib/tenants/provisioning-markers.ts for the
   * WhatsApp routability pair, written by the onboarding orchestrator and the
   * reconcile job). `engine` is the chatbot-motor flag: "cloudflare" → served by
   * the bot-engine Worker (every new tenant); absent/"n8n" → legacy historical
   * rows only. Read via getBotEngine() (src/lib/tenants/engine-health.ts). */
  provisioning?: {
    whatsapp_attached?: boolean;
    sandbox_routable?: boolean;
    slug?: string;
    engine?: import("@/lib/tenants/engine-health").BotEngine;
    [key: string]: unknown;
  };
  /** Booking-policy thresholds the n8n bot (and /api/ai/book) read to decide
   * auto-confirm vs manual review vs refuse. Written at onboarding from the wizard
   * and editable in Settings → Features. `party_size_threshold_large` is the first
   * party size that needs manual confirmation (= owner's "auto-confirm up to N" + 1). */
  bot_config?: {
    party_size_threshold_large?: number;
    party_size_block_threshold?: number;
    closing_time_offset_min?: number;
    /** Kill switch (Settings → Bookings). When true the WhatsApp engine stops
     * handling requests and replies with bot_paused_message only. */
    bot_paused?: boolean;
    /** The auto-reply sent while bot_paused is true — redirects to the owner. */
    bot_paused_message?: string;
    [key: string]: any;
  };
  /** Billing/subscription state, written by the Stripe/PayPal webhooks (Settings →
   * Payments). PUBLIC metadata only — the provider ids and status the UI shows.
   * Secrets (API keys, webhook secrets) NEVER live here: like POS credentials they
   * go encrypted in the dedicated payment_secrets table. The active subscription is
   * the source of truth in the `subscriptions` table; this mirror is what the CRM
   * reads cheaply at boot to know the current plan without a Stripe round-trip. */
  billing?: {
    /** Currently active plan, or null/absent when the tenant has no subscription. */
    plan?: "premium" | "business";
    cycle?: "monthly" | "yearly";
    /** Lifecycle as reported by the provider: active, trialing, past_due, canceled. */
    status?: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
    provider?: "stripe" | "paypal";
    /** ISO timestamp the current paid period ends (renewal or expiry). */
    current_period_end?: string;
    /** Add-on ids the tenant currently subscribes to. */
    addons?: string[];
    /** Provider customer/subscription ids — references, not secrets. */
    stripe_customer_id?: string;
    stripe_subscription_id?: string;
    paypal_subscription_id?: string;
  };
  /** Data-protection / GDPR-FADP config. A single `country` drives region-specific
   * behaviour (privacy-notice defaults, AI-disclosure duty, data residency, default
   * retention, which DPA template applies) via src/lib/compliance/regions.ts, so one
   * codebase serves ES/IT/DE/CH without forking. `retention_days`, `ai_disclosure`
   * and `privacy_url` are optional overrides on top of the region defaults. When the
   * whole block is absent the tenant is treated as EU-strict (disclosure ON) but the
   * retention job stays INERT (it only ever deletes for tenants that have explicitly
   * opted in via `country` or `retention_days`), so nothing is purged by surprise. */
  compliance?: {
    /** ISO 3166-1 alpha-2 of the tenant's market. Unset → EU-strict defaults. */
    country?: "ES" | "IT" | "DE" | "CH";
    /** Override the region-default retention (days) for closed conversation
     * transcripts. 0/undefined → region default; a positive number wins. */
    retention_days?: number;
    /** Force the "you're talking to an AI assistant" first-contact disclosure
     * on/off. Unset → region default (ON in the EU per AI Act Art. 50). */
    ai_disclosure?: boolean;
    /** Public privacy-notice URL surfaced at first contact (transparency duty). */
    privacy_url?: string;
  };
  /** Platform-admin MANUAL overrides for paid entitlements, applied on top of —
   * and winning over — `billing` (so a provider webhook can't undo them). Used to
   * hand-activate or hand-suspend paid services when payment is in dispute.
   * Tri-state per key: `true` = force on, `false` = force off, absent = follow
   * billing. `plan` overrides core-CRM access (hasActivePlan); `addons[id]`
   * overrides a single add-on (entitlementFor / hasAddon). */
  manual_entitlements?: {
    plan?: boolean;
    addons?: Record<string, boolean>;
  };
  [key: string]: any;
}

/** Read the effective flags for a tenant, applying defaults for anything unset.
 * Single source of truth — the app and (future) engine both read flags via this.
 *
 * `management_enabled` is special: it's a PAID add-on (smart_inventory). Its
 * effective value is "the raw flag is on (manual override)" OR "the add-on is
 * paid and active (incl. the 7-day grace window)". By deriving it HERE, every
 * existing call site that reads getFeatures().management_enabled — sidebar, page
 * guards, the finance API — gets billing-aware gating for free, with the unlock /
 * re-lock rules living only in entitlements.ts. The raw stored flag stays the
 * manual override (admin trial/gift, or a fallback if billing ever hiccups). */
export function getFeatures(settings: TenantSettings | null | undefined): TenantFeatures {
  const merged = { ...DEFAULT_FEATURES, ...(settings?.features || {}) };
  merged.management_enabled = hasManagement(settings);
  return merged;
}

/** The RAW stored flags — defaults merged with settings.features, WITHOUT the
 * billing derivation. Use this anywhere you EDIT the flags (the admin feature
 * toggle, Settings → Funzionalità): the management toggle there must reflect and
 * write the MANUAL OVERRIDE bit, not the paid-add-on-derived value — otherwise
 * toggling any unrelated flag would persist the derived `true` back into the raw
 * override, silently turning the manual switch on. Consumers that only READ
 * effective access (sidebar, page guards, APIs) use getFeatures() instead. */
export function getRawFeatures(settings: TenantSettings | null | undefined): TenantFeatures {
  return { ...DEFAULT_FEATURES, ...(settings?.features || {}) };
}

/**
 * Which voice provider actually serves this tenant's calls.
 *
 * Tiering rule: Vapi is the BASE service everyone gets; Retell is the PREMIUM
 * paid upgrade. The explicit `settings.voice.provider` flag is the source of
 * truth. For legacy tenants written before the flag existed, fall back to the
 * same deduction teardown.ts uses — a Retell agent id without the flag means a
 * legacy Retell tenant; otherwise base (Vapi). Default for anything new/unset is
 * always `vapi`. */
export function getVoiceProvider(settings: TenantSettings | null | undefined): VoiceProviderTier {
  const explicit = settings?.voice?.provider;
  if (explicit === "vapi" || explicit === "retell") return explicit;
  // Compat: no flag → deduce. A stored Retell agent (and no flag) = legacy premium.
  if (settings?.retell?.agentId) return "retell";
  return "vapi";
}

/**
 * Map the onboarding wizard's fixed-field answers to the feature flags, so a
 * toggle in Settings → Features starts out matching what the owner said in the
 * wizard (e.g. "no terrace" → terrace OFF) instead of the generic default.
 *
 * Only flags the wizard can ANSWER are derived here; the rest fall back to
 * DEFAULT_FEATURES. The wizard never asks about separate rooms, so `multi_room`
 * stays at its default (false) and the owner enables it from Settings when they
 * build a second zone on the floor map.
 *
 * `langCount` is how many assistant languages the owner selected (the wizard
 * sends them separately from the questionnaire), driving `multi_language`.
 */
export function featuresFromQuestionnaire(
  q: {
    terrace?: boolean;
    pets?: boolean;
    celebrations?: boolean;
    accepts_large_groups?: boolean;
    last_lunch_offset_min?: number;
    last_dinner_offset_min?: number;
  },
  langCount: number,
): TenantFeatures {
  return {
    ...DEFAULT_FEATURES,
    terrace: !!q.terrace,
    pet_friendly: !!q.pets,
    // The venue hosts private events / large groups if it welcomes either.
    events_enabled: !!q.celebrations || !!q.accepts_large_groups,
    // The bot answers in several languages only if the owner picked more than one.
    multi_language: langCount > 1,
    // Double service = both lunch and dinner are actually served. A shift with
    // offset -1 means "no service" for that shift (see KbQuestionnaire).
    double_shift: q.last_lunch_offset_min !== -1 && q.last_dinner_offset_min !== -1,
  };
}

/**
 * Venue facts the assistant conveys to guests, derived from feature flags.
 *
 * Some flags change CRM screens directly (waitlist → sidebar, multi_room →
 * floor zones, double_shift → shift toggle). These four instead change what the
 * ASSISTANT knows about the venue — so the single honest home for them is the
 * bot's info source (/api/ai/restaurant-info), as CONFIG rather than per-tenant
 * hand-written Knowledge Base text. Front-loading them here means a new client
 * who wants "we have a terrace" / "pets welcome" is a toggle, not a code change. */
export function restaurantFacts(settings: TenantSettings | null | undefined) {
  const f = getFeatures(settings);
  return {
    terrace: f.terrace,             // outdoor seating available
    pet_friendly: f.pet_friendly,   // pets welcome
    events: f.events_enabled,       // hosts private events / large groups
    multi_language: f.multi_language, // assistant mirrors the guest's language
  };
}
