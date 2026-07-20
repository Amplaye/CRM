import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantStatus } from "./status";
import { complianceSettingsForCountry, complianceSettingsForPhone } from "@/lib/compliance/detect-country";

/**
 * Single way to create a tenant row.
 *
 * Before this helper, three call sites inserted into `tenants` independently
 * (self-signup, guest demo, onboarding wizard) — so the initial lifecycle
 * status could drift. Centralising it keeps the SaaS gate coherent: every
 * tenant is born with an explicit `status` (see ./status).
 *
 * Single vertical by design: `business_type` is always "restaurant" (dormant
 * hook column). We never trust a value coming from a form.
 */
export interface CreateTenantInput {
  name: string;
  settings: Record<string, any>;
  /** Lifecycle status at birth. Pass explicitly per call site. */
  status: TenantStatus;
  /**
   * Optional URL-safe slug. `tenants.slug` is NOT NULL with no default, so one
   * is ALWAYS required — if a call site doesn't pass it, we derive it from the
   * name. Centralising this here is deliberate: leaving slug to the caller is
   * exactly what silently 500'd self-signup (register-tenant never set it, so
   * the insert failed and the owner ended up with no tenant).
   */
  slug?: string;
  /**
   * Venue phone in international form. Used ONLY to derive the data-protection
   * country (`settings.compliance.country`) at birth, so the retention policy is
   * configured automatically instead of depending on an admin filling the form
   * later — which never happened, leaving every tenant's retention job inert.
   * When it yields no supported market the tenant stays unset (safe default).
   * An explicit `settings.compliance` always wins over this inference.
   */
  phone?: string | null;
  /**
   * Compliance country the owner DECLARED (self-signup dropdown). Wins over the
   * phone inference: a stated market beats a guessed one. Ignored when it isn't
   * one of the supported markets, so a stale/garbage value can't assign a regime.
   */
  country?: string | null;
}

// Build a URL-safe slug from a free-text name. Falls back to "resto" when the
// name has no usable characters (e.g. emoji-only), and always returns something
// non-empty so the NOT NULL constraint is satisfied.
function slugify(name: string): string {
  const base = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "resto";
}

export async function createTenant(
  supabase: SupabaseClient,
  input: CreateTenantInput
): Promise<{ id: string }> {
  // slug is NOT NULL and unique-ish across tenants. Derive from the name when
  // not supplied, then append a short random suffix so two restaurants with the
  // same name never collide on the column (or on n8n webhook paths downstream).
  const suffix = Math.random().toString(36).slice(2, 8);
  const slug = `${input.slug?.trim() || slugify(input.name)}-${suffix}`;

  // Seed the data-protection policy from the venue's dialling prefix. Never
  // overrides a compliance block the caller passed explicitly, and stays absent
  // when the prefix isn't one of our markets (see ./detect-country for why we
  // don't fall back to timezone or geo-IP).
  const settings = { ...input.settings };
  if (!settings.compliance) {
    const compliance =
      complianceSettingsForCountry(input.country) ?? complianceSettingsForPhone(input.phone);
    if (compliance) settings.compliance = compliance;
  }

  const { data, error } = await supabase
    .from("tenants")
    .insert({
      name: input.name,
      slug,
      business_type: "restaurant",
      status: input.status,
      settings,
    })
    .select("id")
    .single();

  if (error) throw new Error(`tenant insert: ${error.message}`);
  return { id: data.id as string };
}
