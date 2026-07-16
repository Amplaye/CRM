import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertPlatformAdmin } from '@/lib/admin-auth';

// Revoke an api-key by setting revoked_at. Hard-delete is never offered:
// keeping the hash around prevents accidental re-issuance with the same key.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; keyId: string }> }
) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const { id: tenantId, keyId } = await ctx.params;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('tenant_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', keyId)
    .select('id, label, revoked_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
