import { createServiceRoleClient } from '@/lib/supabase/server';
import { getFeatures, type TenantFeatures } from '@/lib/types/tenant-settings';

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Server-side: a tenant's effective feature flags, by id.
 *
 * Single source for the shared AI engine — the `/api/ai/*` routes the bot calls.
 * Flipping a flag in Settings must change ENGINE behaviour, not only the CRM UI;
 * before this helper, `waitlist_enabled` only hid the sidebar item while the bot
 * kept queuing guests. See docs/PIANO_SAAS.md (Mossa 3): the Next.js API layer is
 * the shared engine we control today (the n8n/Vapi layer is Mossa 6).
 *
 * Pass an existing client to reuse the request's connection. Unknown/missing
 * tenants fall back to DEFAULT_FEATURES (fail-open: never silently break a live
 * tenant on a transient read).
 */
export async function getTenantFeatures(
  tenantId: string,
  client?: ServiceClient,
): Promise<TenantFeatures> {
  const supabase = client ?? createServiceRoleClient();
  const { data } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();
  return getFeatures(data?.settings as Parameters<typeof getFeatures>[0]);
}
