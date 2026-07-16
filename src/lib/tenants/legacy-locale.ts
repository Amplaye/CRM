/**
 * The CRM dashboard language is normally FIXED per tenant (settings.crm_locale,
 * chosen once at onboarding — no in-app switcher; see Providers.CrmLanguageBridge
 * and Topbar). PICNIC is the one exception: it is the legacy "template" tenant
 * used to demo the product to prospects, who may speak any of the four UI
 * languages. For PICNIC only we keep the in-Topbar language dropdown so the
 * language can be switched on the fly, and we suppress the bridge so that choice
 * isn't immediately overwritten back to crm_locale.
 *
 * This is intentionally a slug allowlist (not a feature flag): the behaviour
 * exists solely for this one legacy tenant and must not leak to real clients.
 */
export const LEGACY_LOCALE_SWITCHER_SLUGS = ["picnic"] as const;

/** True when the given tenant should show the in-app CRM language switcher. */
export function tenantHasLocaleSwitcher(slug: string | null | undefined): boolean {
  return !!slug && (LEGACY_LOCALE_SWITCHER_SLUGS as readonly string[]).includes(slug);
}
