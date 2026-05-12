import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertPlatformAdmin } from '@/lib/admin-auth';

// GDPR Article 15 — data export (Tier 7.1).
// Returns the full guest profile plus every reservation, conversation and
// waitlist entry tied to that guest, as a JSON download named
// guest-<id>-export.json. Owner/admin only.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  const { id: guestId } = await ctx.params;

  const supabase = createServiceRoleClient();
  const { data: guest, error: gErr } = await supabase
    .from('guests')
    .select('*')
    .eq('id', guestId)
    .maybeSingle();
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });
  if (!guest) return NextResponse.json({ error: 'guest not found' }, { status: 404 });

  const [reservations, conversations, waitlist] = await Promise.all([
    supabase.from('reservations').select('*').eq('guest_id', guestId),
    supabase.from('conversations').select('*').eq('guest_id', guestId),
    supabase.from('waitlist_entries').select('*').eq('guest_id', guestId),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    guest,
    reservations: reservations.data ?? [],
    conversations: conversations.data ?? [],
    waitlist_entries: waitlist.data ?? [],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="guest-${guestId}-export.json"`,
    },
  });
}
