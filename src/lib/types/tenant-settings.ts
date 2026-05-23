// Feature flags + typed tenant settings.
import type { TenantStatus } from "@/lib/tenants/status";
//
// SaaS principle (see docs/PIANO_SAAS.md, Mossa 3): a restaurant's differences
// live as DATA here — config, never forked code. Adding a new capability means
// adding ONE flag to this template; every future tenant then has it for free.
// The matching "is this variant finite?" log lives in docs/REGISTRO_VARIANTI.md.

/** On/off capabilities a single restaurant can have. Plain, owner-answerable. */
export interface TenantFeatures {
  waitlist_enabled: boolean; // collect guests when full, notify on free table
  multi_room: boolean;       // separate rooms / areas
  double_shift: boolean;     // open for both lunch and dinner
  multi_language: boolean;   // bot answers guests in several languages
  events_enabled: boolean;   // special nights / private events / large groups
  terrace: boolean;          // outdoor seating
  pet_friendly: boolean;     // pets allowed
}

/** Sensible defaults for an average restaurant. Chosen so existing tenants keep
 * today's behaviour: waitlist/double-shift/multi-language stay ON, the rest OFF
 * until an owner opts in. */
export const DEFAULT_FEATURES: TenantFeatures = {
  waitlist_enabled: true,
  multi_room: false,
  double_shift: true,
  multi_language: true,
  events_enabled: false,
  terrace: false,
  pet_friendly: false,
};

/** Ordered list driving the Settings → Features UI (label/hint via i18n keys). */
export const FEATURE_FLAGS: ReadonlyArray<{ key: keyof TenantFeatures; labelKey: string; hintKey: string }> = [
  { key: "waitlist_enabled", labelKey: "settings_feature_waitlist", hintKey: "settings_feature_waitlist_hint" },
  { key: "double_shift", labelKey: "settings_feature_double_shift", hintKey: "settings_feature_double_shift_hint" },
  { key: "multi_room", labelKey: "settings_feature_multi_room", hintKey: "settings_feature_multi_room_hint" },
  { key: "multi_language", labelKey: "settings_feature_multi_language", hintKey: "settings_feature_multi_language_hint" },
  { key: "events_enabled", labelKey: "settings_feature_events", hintKey: "settings_feature_events_hint" },
  { key: "terrace", labelKey: "settings_feature_terrace", hintKey: "settings_feature_terrace_hint" },
  { key: "pet_friendly", labelKey: "settings_feature_pet_friendly", hintKey: "settings_feature_pet_friendly_hint" },
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
  currency?: string;
  ai_enabled_channels?: string[];
  features?: Partial<TenantFeatures>;
  /** Per-tenant WhatsApp channel config. `from` is the tenant's own sender
   * number (e.g. "whatsapp:+34..."); unset → platform default. Resolved in one
   * place by src/lib/whatsapp/from.ts (Mossa 5: sending number is config, not code). */
  whatsapp?: { from?: string };
  /** Offboarding bookkeeping, written by the archive flow (src/lib/tenants/delete-tenant.ts). */
  archive?: { prev_status: TenantStatus; export_path?: string };
  /** Voice provider config — exactly one is present per tenant. */
  vapi?: { assistantId?: string };
  retell?: { agentId?: string; llmId?: string };
  retell_kb?: { id?: string };
  /** Cloned n8n workflow ids (present for tenants provisioned via the orchestrator). */
  n8n?: { workflow_ids?: string[] };
  [key: string]: any;
}

/** Read the effective flags for a tenant, applying defaults for anything unset.
 * Single source of truth — the app and (future) engine both read flags via this. */
export function getFeatures(settings: TenantSettings | null | undefined): TenantFeatures {
  return { ...DEFAULT_FEATURES, ...(settings?.features || {}) };
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
