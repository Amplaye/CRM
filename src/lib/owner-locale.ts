// Owner-facing language resolution.
//
// Every cloned tenant ships its own primary language (see TenantSettings:
// `crm_locale` is the bare dashboard code chosen at onboarding, `locale` the
// derived assistant locale like "it-IT"). Owner notifications — weekly report,
// daily summary, pre-turno, nightly audit digest — must speak THAT language,
// not Spanish. Historically every notification was hardcoded Spanish because it
// was forked from the Picnic template (whose owner is Spanish); a clone like
// Oraz (Italian) inherited the Spanish copy. This is the single place the server
// resolves the owner's language so callers don't re-derive it ad hoc.

export type OwnerLang = "es" | "it" | "en" | "de";

/** Map anything (a bare code, a "it-IT" locale, junk) to a supported language,
 * defaulting to Spanish (the template's language) when unknown. */
export function toOwnerLang(maybe: unknown): OwnerLang {
  const code = String(maybe || "").trim().toLowerCase().slice(0, 2);
  return (["es", "it", "en", "de"] as const).includes(code as OwnerLang)
    ? (code as OwnerLang)
    : "es";
}

/** Resolve the owner language from a tenant's settings JSONB. Prefers the
 * explicit dashboard language, then the assistant locale, then Spanish. */
export function ownerLangFromSettings(settings: unknown): OwnerLang {
  const s = (settings || {}) as { crm_locale?: unknown; locale?: unknown };
  return toOwnerLang(s.crm_locale ?? s.locale);
}
