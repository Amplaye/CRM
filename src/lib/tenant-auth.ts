import crypto from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/**
 * Resolve a `Bearer ...` API key to the owning tenant_id via tenant_api_keys.
 *
 * Only high-entropy keys (crypto.randomBytes(32), issued by the api-keys route)
 * are accepted. The old `Bearer {tenant_id}` scheme — where key_hash was just
 * sha256(tenant_id) — is rejected: tenant_id is a non-secret UUID, so anyone
 * who learned one could authenticate as that tenant. Those legacy rows have
 * been revoked; this also refuses any key whose value is the tenant UUID, as
 * defense in depth against a re-seed.
 *
 * Returns null when the key isn't registered, is revoked, or is a legacy
 * self-hash key.
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

  // Reject the legacy `Bearer <tenant_id>` scheme: a key equal to the tenant
  // UUID hashes to sha256(tenant_id) and must never authenticate.
  if (apiKey === row.tenant_id || keyHash === hashApiKey(String(row.tenant_id))) {
    return null;
  }

  // Best-effort last_used_at refresh; never block the request on it.
  void supabase
    .from('tenant_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id);
  return row.tenant_id as string;
}
