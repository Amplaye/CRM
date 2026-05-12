import crypto from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/**
 * Resolve a `Bearer ...` API key to the owning tenant_id via tenant_api_keys.
 *
 * Backward-compat: if the key isn't registered AND it looks like a bare
 * tenant UUID, we accept it and return it as the tenant_id. This keeps the
 * legacy "Bearer {tenant_id}" callers working until they migrate. New
 * deployments should always pass a hashed key.
 *
 * Returns null when the key is neither registered nor a valid UUID.
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

  if (row?.tenant_id) {
    // Best-effort last_used_at refresh; never block the request on it.
    void supabase
      .from('tenant_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id);
    return row.tenant_id as string;
  }

  // Legacy fallback: accept Bearer {tenant_uuid} so existing n8n callers
  // keep working until they switch to hashed keys.
  if (UUID_RE.test(apiKey)) return apiKey;

  return null;
}
