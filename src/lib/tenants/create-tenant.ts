import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantStatus } from "./status";

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

  const { data, error } = await supabase
    .from("tenants")
    .insert({
      name: input.name,
      slug,
      business_type: "restaurant",
      status: input.status,
      settings: input.settings,
    })
    .select("id")
    .single();

  if (error) throw new Error(`tenant insert: ${error.message}`);
  return { id: data.id as string };
}
