import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertPlatformAdmin } from '@/lib/admin-auth';
import { hashApiKey } from '@/lib/tenant-auth';

// Forces a freshly-generated key to be shown exactly once. Future GET calls
// only return the metadata (id, label, last_used_at, revoked_at).
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const { id: tenantId } = await ctx.params;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('tenant_api_keys')
    .select('id, label, scope, created_at, last_used_at, revoked_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const { id: tenantId } = await ctx.params;

  let body: { label?: string; scope?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const label = (body.label || '').slice(0, 80) || 'api-key';
  const validScopes = ['webhooks', 'admin', 'ai_secret', 'readonly'];
  const scope = validScopes.includes(body.scope || '') ? (body.scope as string) : 'webhooks';

  // 32 random bytes hex = 64 chars. Caller stores this once and uses it as
  // the Bearer token.
  const apiKey = crypto.randomBytes(32).toString('hex');
  const keyHash = hashApiKey(apiKey);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('tenant_api_keys')
    .insert({ tenant_id: tenantId, key_hash: keyHash, label, scope })
    .select('id, label, scope, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ...data, api_key: apiKey }, { status: 201 });
}
