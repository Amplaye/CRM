import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertPlatformAdmin } from '@/lib/admin-auth';
import { logAuditEvent } from '@/lib/audit';

// GDPR Article 17 — right to be forgotten (Tier 7.2).
// Anonymizes the guest row (name → "Anonymized Guest", phone → null,
// notes → "") instead of hard-deleting, so historical reservations and
// analytics keep working. Wipes conversations.transcript for that
// guest (the booking metadata is retained for aggregates).
//
// Owner/admin only. Logged to audit_events for legal trail.
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const { id: guestId } = await ctx.params;

  const supabase = createServiceRoleClient();
  const { data: guest, error: gErr } = await supabase
    .from('guests')
    .select('id, tenant_id, name, phone')
    .eq('id', guestId)
    .maybeSingle();
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
  if (!guest) return NextResponse.json({ error: 'guest not found' }, { status: 404 });

  const stamp = new Date().toISOString();
  const anonName = `Anonymized Guest (${stamp.slice(0, 10)})`;

  // Pseudonymize the guest row. Phone goes to null so the UNIQUE indices
  // free up if someone with a fresh phone reaches out later.
  const { error: updErr } = await supabase
    .from('guests')
    .update({ name: anonName, phone: null, notes: '', tags: [] })
    .eq('id', guestId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Wipe transcripts but keep conversation rows for aggregate counters.
  await supabase
    .from('conversations')
    .update({ transcript: [], summary: '[anonymized]' })
    .eq('guest_id', guestId);

  await logAuditEvent({
    tenant_id: guest.tenant_id,
    action: 'gdpr_erase_guest',
    entity_id: guestId,
    source: 'staff',
    agent_id: auth.userId,
    details: { erased_at: stamp, previous_phone_hash: guest.phone ? 'present' : 'none' },
  });

  return NextResponse.json({ ok: true, guest_id: guestId, anonymized_at: stamp });
}
