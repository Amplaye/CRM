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
}

export async function createTenant(
  supabase: SupabaseClient,
  input: CreateTenantInput
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("tenants")
    .insert({
      name: input.name,
      business_type: "restaurant",
      status: input.status,
      settings: input.settings,
    })
    .select("id")
    .single();

  if (error) throw new Error(`tenant insert: ${error.message}`);
  return { id: data.id as string };
}
