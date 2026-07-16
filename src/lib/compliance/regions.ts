// Per-region config engine — the SINGLE source of truth that turns a tenant's
// `settings.compliance.country` into the concrete data-protection behaviour for
// that market. One codebase serves Spain, Italy, Germany and Switzerland because
// the differences (framework, residency, retention, AI-disclosure duty, which DPA
// template applies, the localized first-contact line) live here as DATA, never as
// forked code. Everything that needs a compliance decision — the retention cron,
// the AI-disclosure toggle, the DSAR export header, the admin panel — reads it via
// getComplianceConfig() and nothing else.
//
// Design choices worth knowing:
//   • When `country` is UNSET the tenant is treated as EU-strict (disclosure ON,
//     30-day transcript retention) so we never under-protect by default — BUT the
//     retention job stays inert unless the tenant explicitly opted in (see
//     isRetentionEnabled): safe-by-default means "never delete a tenant's data
//     until a human configured a policy for them".
//   • The three EU markets share one regime (GDPR) with national quirks noted in
//     `notes`; Switzerland (revFADP) is separate but converges to the same setup
//     for restaurants + ordinary B2B.

import type { TenantSettings } from "@/lib/types/tenant-settings";

export type ComplianceCountry = "ES" | "IT" | "DE" | "CH";

/** The languages our first-contact / consent copy is localized into. Maps 1:1 to
 * the CRM `crm_locale` codes so we can reuse the tenant's chosen dashboard
 * language when a message language isn't otherwise known. */
export type ComplianceLang = "es" | "it" | "de" | "en";

/** Where a tenant's data must live at rest. Both values are "EU-adequate" for all
 * four markets (Switzerland treats the EU as adequate), so EU hosting satisfies
 * every market and sidesteps the US-transfer question. `ch` is offered for Swiss
 * clients who contractually want in-country residency. */
export type ResidencyRegion = "eu" | "ch";

export interface RegionConfig {
  country: ComplianceCountry;
  /** Human label for the applicable framework (shown in the admin panel + DSAR). */
  framework: string;
  /** Data-residency region required for this market. */
  residency: ResidencyRegion;
  /** Is the market inside the EU/EEA (GDPR) vs Switzerland (revFADP)? */
  eu: boolean;
  /** Default retention (days) for CLOSED conversation transcripts before the
   * retention job removes them. Business records (reservations) are out of scope —
   * they're kept for accounting obligations and only removed on tenant purge. */
  defaultRetentionDays: number;
  /** Is the "you're talking to an AI" disclosure legally required by default?
   * True for the EU (AI Act Art. 50, transparency duties from Aug 2026); Swiss law
   * has no equivalent statute yet, so it defaults ON as a trust signal but is not
   * a legal default. */
  aiDisclosureDefault: boolean;
  /** Which reusable DPA template applies (client↔BALI). The wording is [LEGAL]; this
   * is just the id the admin/records-of-processing reference. */
  dpaTemplate: "gdpr" | "revfadp";
  /** Default CRM/consent language for this market. */
  lang: ComplianceLang;
  /** Free-text practitioner notes (e.g. Italy's Garante is the most aggressive EU
   * regulator on AI). Surfaced in the admin panel. */
  notes: string;
}

/** The four markets in scope. Adding a market = adding one row here. */
export const REGIONS: Record<ComplianceCountry, RegionConfig> = {
  ES: {
    country: "ES",
    framework: "GDPR + LOPDGDD",
    residency: "eu",
    eu: true,
    defaultRetentionDays: 30,
    aiDisclosureDefault: true,
    dpaTemplate: "gdpr",
    lang: "es",
    notes: "GDPR + Spanish LOPDGDD. Ordinary data on contract/legitimate-interest basis; explicit consent for health/allergy (Art. 9).",
  },
  IT: {
    country: "IT",
    framework: "GDPR + Codice Privacy",
    residency: "eu",
    eu: true,
    defaultRetentionDays: 30,
    aiDisclosureDefault: true,
    dpaTemplate: "gdpr",
    lang: "it",
    notes: "GDPR + Italian Codice Privacy. The Garante is the EU's most aggressive regulator on AI (temporarily banned ChatGPT in 2023) — extra care in IT.",
  },
  DE: {
    country: "DE",
    framework: "GDPR + BDSG",
    residency: "eu",
    eu: true,
    defaultRetentionDays: 30,
    aiDisclosureDefault: true,
    dpaTemplate: "gdpr",
    lang: "de",
    notes: "GDPR + German BDSG. Strong privacy culture — expect scrutiny; keep data minimization and residency tight.",
  },
  CH: {
    country: "CH",
    framework: "revFADP (nDSG)",
    residency: "ch",
    eu: true, // treated as EU-adequate; EU hosting is clean for CH data
    defaultRetentionDays: 30,
    aiDisclosureDefault: true,
    dpaTemplate: "revfadp",
    lang: "de",
    notes: "Revised FADP (in force since 1 Sep 2023). Explicit consent for besonders schützenswerte Personendaten. Art. 321 StGB makes mishandled medical/legal secrecy CRIMINAL — the doctor vertical stays gated.",
  },
};

/** The EU-strict fallback used when a tenant has no `country` set: assume the
 * strictest ordinary posture (disclosure ON, 30-day retention) so we never
 * under-protect. Modelled on Germany (no national carve-outs that loosen it). */
const FALLBACK: RegionConfig = {
  ...REGIONS.DE,
  framework: "GDPR (EU-strict default — country not set)",
  notes: "No country configured for this tenant → EU-strict defaults applied. Set a country in the Data Protection panel to localize.",
};

/** Resolve a country code (case-insensitive) to its region config, or the
 * EU-strict fallback when it's unset/unknown. */
export function regionFor(country: string | null | undefined): RegionConfig {
  if (!country) return FALLBACK;
  const key = country.toUpperCase() as ComplianceCountry;
  return REGIONS[key] ?? FALLBACK;
}

export interface ComplianceConfig {
  /** The country that was actually configured, or null when relying on the fallback. */
  country: ComplianceCountry | null;
  region: RegionConfig;
  /** Effective transcript retention in days (override wins over region default). */
  retentionDays: number;
  /** Effective AI-disclosure state (override wins over region default). */
  aiDisclosure: boolean;
  /** Public privacy-notice URL, or null when the tenant hasn't set one. */
  privacyUrl: string | null;
  /** True only when this tenant has explicitly opted into a retention policy, i.e.
   * a `country` OR an explicit positive `retention_days` is present. The retention
   * cron uses this to stay inert for un-configured tenants (safe by default). */
  retentionEnabled: boolean;
}

/** THE resolver. Reads `settings.compliance`, applies region defaults, and returns
 * the effective config every consumer uses. Pure — no I/O, safe to call anywhere. */
export function getComplianceConfig(settings: TenantSettings | null | undefined): ComplianceConfig {
  const c = settings?.compliance || {};
  const country = (c.country && REGIONS[c.country] ? c.country : null) as ComplianceCountry | null;
  const region = regionFor(country);

  const overrideRetention =
    typeof c.retention_days === "number" && Number.isFinite(c.retention_days) && c.retention_days > 0
      ? Math.floor(c.retention_days)
      : null;

  return {
    country,
    region,
    retentionDays: overrideRetention ?? region.defaultRetentionDays,
    aiDisclosure: typeof c.ai_disclosure === "boolean" ? c.ai_disclosure : region.aiDisclosureDefault,
    privacyUrl: c.privacy_url && c.privacy_url.trim() ? c.privacy_url.trim() : null,
    retentionEnabled: !!country || overrideRetention !== null,
  };
}

/** Whether the retention job should act on this tenant at all. Extracted so the
 * cron/planner reads intent in one obvious place. */
export function isRetentionEnabled(settings: TenantSettings | null | undefined): boolean {
  return getComplianceConfig(settings).retentionEnabled;
}

// ── First-contact AI-disclosure line ────────────────────────────────────────
// One unobtrusive opening line per channel that satisfies BOTH the transparency
// duty (a linked privacy notice) AND the AI-disclosure duty in a single sentence.
// Localized; `{brand}` is substituted with the venue name. Kept deliberately short
// so it reads as a pinned first message, not a consent wall.

const DISCLOSURE_TEMPLATES: Record<ComplianceLang, (brand: string) => string> = {
  es: (b) => `¡Hola! Reservas para ${b}, gestionadas por un asistente de IA. Tratamos tus datos según nuestra política de privacidad.`,
  it: (b) => `Ciao! Prenotazioni per ${b}, gestite da un assistente AI. Trattiamo i tuoi dati secondo la nostra informativa privacy.`,
  de: (b) => `Hallo! Reservierungen für ${b}, betreut von einem KI-Assistenten. Wir verarbeiten deine Daten gemäß unserer Datenschutzerklärung.`,
  en: (b) => `Hi! Reservations for ${b}, handled by an AI assistant. We process your data per our privacy policy.`,
};

export interface AiDisclosure {
  /** Whether the disclosure should be shown at first contact. */
  enabled: boolean;
  /** The localized line (empty string when disabled). Append the privacy URL. */
  text: string;
  /** The privacy-notice URL to link, or null. */
  privacyUrl: string | null;
}

/** Build the first-contact disclosure line for a tenant. `brand` is the venue name;
 * `lang` overrides the region/CRM language when the guest's language is known. */
export function getAiDisclosure(
  settings: TenantSettings | null | undefined,
  brand: string,
  lang?: ComplianceLang,
): AiDisclosure {
  const cfg = getComplianceConfig(settings);
  const resolvedLang: ComplianceLang =
    lang || (settings?.crm_locale as ComplianceLang | undefined) || cfg.region.lang;
  if (!cfg.aiDisclosure) return { enabled: false, text: "", privacyUrl: cfg.privacyUrl };
  const base = (DISCLOSURE_TEMPLATES[resolvedLang] || DISCLOSURE_TEMPLATES.en)(brand || "");
  const text = cfg.privacyUrl ? `${base} ${cfg.privacyUrl}` : base;
  return { enabled: true, text, privacyUrl: cfg.privacyUrl };
}
