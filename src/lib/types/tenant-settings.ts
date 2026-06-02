// Feature flags + typed tenant settings.
import type { TenantStatus } from "@/lib/tenants/status";
//
// SaaS principle (see docs/PIANO_SAAS.md, Mossa 3): a restaurant's differences
// live as DATA here — config, never forked code. Adding a new capability means
// adding ONE flag to this template; every future tenant then has it for free.
// The matching "is this variant finite?" log lives in docs/REGISTRO_VARIANTI.md.

/** Voice tier. `vapi` = base (default, every tenant); `retell` = premium upgrade. */
export type VoiceProviderTier = "vapi" | "retell";

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
  { key: "reminders_enabled", labelKey: "settings_feature_reminders", hintKey: "settings_feature_reminders_hint" },
  { key: "followup_enabled", labelKey: "settings_feature_followup", hintKey: "settings_feature_followup_hint" },
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
  /** Offboarding bookkeeping, written by the archive flow (src/lib/tenants/delete-tenant.ts). */
  archive?: { prev_status: TenantStatus; export_path?: string };
  /** Which voice platform serves this tenant's calls. Vapi is the BASE tier
   * (default for every tenant); Retell is the PREMIUM paid upgrade. Switching
   * tiers flips this flag — both providers run the SAME prompt (built from
   * voice-prompt.ts), so the switch is a routing change, not a rebuild. When the
   * flag is absent (legacy tenants written before tiering), getVoiceProvider
   * falls back to deducing it from which provider id is stored. */
  voice?: { provider?: VoiceProviderTier };
  /** Voice provider ids — both may be present (a premium tenant keeps its Vapi
   * clone so a downgrade back to base is instant). `voice.provider` decides which
   * one actually serves calls. */
  vapi?: { assistantId?: string };
  retell?: { agentId?: string; llmId?: string };
  retell_kb?: { id?: string };
  /** Cloned n8n workflow ids (present for tenants provisioned via the orchestrator). */
  n8n?: { workflow_ids?: string[] };
  /** Booking-policy thresholds the n8n bot (and /api/ai/book) read to decide
   * auto-confirm vs manual review vs refuse. Written at onboarding from the wizard
   * and editable in Settings → Features. `party_size_threshold_large` is the first
   * party size that needs manual confirmation (= owner's "auto-confirm up to N" + 1). */
  bot_config?: {
    party_size_threshold_large?: number;
    party_size_block_threshold?: number;
    closing_time_offset_min?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

/** Read the effective flags for a tenant, applying defaults for anything unset.
 * Single source of truth — the app and (future) engine both read flags via this. */
export function getFeatures(settings: TenantSettings | null | undefined): TenantFeatures {
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
