// Single source of truth for a tenant's WhatsApp routability markers.
//
// These two booleans in settings.provisioning decide whether a tenant appears in
// the shared [Meta Router] test menu (sandbox_routable) and whether it has been
// moved onto its own number (whatsapp_attached). They are written in THREE
// places — the onboarding orchestrator's early row creation, its final commit,
// and the self-healing reconcile route — so the precedence rule lives here once
// to keep them from drifting.
//
// The rule that matters: a real customer who has attached their OWN number
// (whatsapp_attached:true) must NEVER be forced back onto the shared sandbox by a
// re-run. Own number wins; otherwise default to routable-in-sandbox.

export interface ProvisioningMarkers {
  whatsapp_attached: boolean;
  sandbox_routable: boolean;
  slug: string;
  /** Chatbot motor ("n8n" | "cloudflare"). Every new tenant is born "cloudflare"
   * (set by the onboarding orchestrator); read via getBotEngine() (engine-health.ts).
   * Not resolved here — the `...p` spread below carries it through untouched, so a
   * reconcile re-run can never flip a tenant back onto the wrong engine. */
  engine?: "n8n" | "cloudflare";
  [k: string]: unknown;
}

/** Lowercase, accent-stripped, hyphenated slug — matches the webhook path the
 * onboarding orchestrator gives a cloned chatbot ("<slug>-whatsapp"). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents: Mágicos → magicos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Merge fresh routability markers onto whatever the tenant already had, never
 * clobbering a number-attach.
 *
 * @param prev      the tenant's existing settings.provisioning (may be undefined)
 * @param fallbackSlug slug to use when none is recorded yet (e.g. input.slug or slugify(name))
 */
export function resolveProvisioningMarkers(
  prev: Record<string, unknown> | undefined,
  fallbackSlug: string,
): ProvisioningMarkers {
  const p = prev || {};
  const attached = p.whatsapp_attached === true;
  return {
    ...p,
    whatsapp_attached: attached,
    // Own number → drop out of the shared test menu. Otherwise default to routable.
    sandbox_routable: attached ? false : ((p.sandbox_routable as boolean | undefined) ?? true),
    slug: (p.slug as string | undefined) || fallbackSlug,
  };
}
