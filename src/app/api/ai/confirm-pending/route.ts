import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { tenant_id, guest_phone } = await request.json();
    if (!tenant_id || !guest_phone) {
      return NextResponse.json({ confirmed: false, error: "Missing params" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    const phoneDigits = guest_phone.replace(/\D/g, '');

    // Find all matching guests
    const { data: guests } = await supabase
      .from('guests')
      .select('id, phone')
      .eq('tenant_id', tenant_id);

    const matchIds = (guests || [])
      .filter((g: any) => {
        const gd = (g.phone || '').replace(/\D/g, '');
        return gd.length >= 7 && (gd.includes(phoneDigits) || phoneDigits.includes(gd));
      })
      .map((g: any) => g.id);

    // Find pending_confirmation reservation for any matching guest
    for (const gid of matchIds) {
      const { data: pending } = await supabase
        .from('reservations')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('guest_id', gid)
        .eq('status', 'pending_confirmation')
        .order('created_at', { ascending: false })
        .limit(1);

      if (pending && pending.length > 0) {
        await supabase
          .from('reservations')
          .update({ status: 'confirmed' })
          .eq('id', pending[0].id);

        return NextResponse.json({ confirmed: true, reservation_id: pending[0].id });
      }
    }

    return NextResponse.json({ confirmed: false, message: "No pending reservation found" });
  } catch (error: any) {
    return NextResponse.json({ confirmed: false, error: error.message }, { status: 500 });
  }
}
