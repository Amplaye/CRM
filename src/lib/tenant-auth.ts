import crypto from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/**
 * Resolve a `Bearer ...` API key to the owning tenant_id via tenant_api_keys.
 *
 * The supabase schema seeds one row per tenant with key_hash = sha256(tenant_id)
 * and label 'legacy-bearer-tenant-id', so callers that still pass
 * `Bearer {tenant_id}` keep working until they switch to a real api-key
 * (revoke the legacy row via /api/admin/tenant/[id]/api-keys/[keyId] to
 * cut them off).
 *
 * Returns null when the key isn't registered (or has been revoked).
 */
export async function resolveTenantFromApiKey(apiKey: string): Promise<string | null> {
  if (!apiKey || typeof apiKey !== 'string') return null;
  const supabase = createServiceRoleClient();

  const keyHash = hashApiKey(apiKey);
  const { data: row } = await supabase
    .from('tenant_api_keys')
    .select('tenant_id, id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (!row?.tenant_id) return null;

  // Best-effort last_used_at refresh; never block the request on it.
  void supabase
    .from('tenant_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id);
  return row.tenant_id as string;
}
