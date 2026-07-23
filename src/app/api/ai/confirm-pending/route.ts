import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { assertActivePlan } from '@/lib/billing/guard';
import { apiError } from "@/lib/api-error";

export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  try {
    const { tenant_id, guest_phone, reservation_id } = await request.json();
    // reservation_id (opzionale) arriva dal bottone SÌ del reminder
    // (payload BR_CONFIRM:<id>): conferma ESATTAMENTE quella prenotazione,
    // senza ambiguità di telefono. guest_phone resta il fallback storico.
    if (!tenant_id || (!guest_phone && !reservation_id)) {
      return NextResponse.json({ confirmed: false, error: "Missing params" }, { status: 400 });
    }

    const noPlan = await assertActivePlan(tenant_id);
    if (noPlan) return noPlan;

    const supabase = createServiceRoleClient();

    // Percorso diretto per id: il reminder ha già identificato la prenotazione.
    if (reservation_id) {
      const { data: resv } = await supabase
        .from('reservations')
        .select('id, status')
        .eq('tenant_id', tenant_id)
        .eq('id', reservation_id)
        .limit(1)
        .maybeSingle();

      if (!resv) {
        return NextResponse.json({ confirmed: false, message: "Reservation not found" });
      }
      // Idempotente: se già confermata, non è un errore (doppio tap sul bottone).
      if (resv.status === 'confirmed') {
        return NextResponse.json({ confirmed: true, reservation_id: resv.id, already: true });
      }
      if (resv.status !== 'pending_confirmation') {
        return NextResponse.json({ confirmed: false, message: "Reservation not pending", status: resv.status });
      }

      await supabase
        .from('reservations')
        .update({ status: 'confirmed' })
        .eq('id', resv.id);

      await supabase
        .from('waitlist_entries')
        .update({
          status: 'converted_to_booking',
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenant_id)
        .eq('matched_reservation_id', resv.id)
        .eq('status', 'offered');

      return NextResponse.json({ confirmed: true, reservation_id: resv.id });
    }

    const phoneDigits = guest_phone.replace(/\D/g, '');

    // Deterministic phone match on last 9 digits (E.164 subscriber part),
    // replacing the old cross-includes() heuristic that could cross-match
    // unrelated numbers sharing a short digit suffix. Abort on multi-match.
    const target = phoneDigits.slice(-9);
    const { data: guests } = await supabase
      .from('guests')
      .select('id, phone')
      .eq('tenant_id', tenant_id);

    const matches = (guests || []).filter((g: any) => {
      const gd = (g.phone || '').replace(/\D/g, '');
      if (gd.length < 7) return false;
      return gd.slice(-9) === target || (gd.length < 9 && target.endsWith(gd));
    });

    if (matches.length === 0) {
      return NextResponse.json({ confirmed: false, message: "No pending reservation found" });
    }
    if (matches.length > 1) {
      return NextResponse.json({
        confirmed: false,
        error: 'Multiple reservations match this phone — need a reservation_id to disambiguate',
      }, { status: 409 });
    }

    const matchIds = matches.map((g: any) => g.id);

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
        const resId = pending[0].id;
        await supabase
          .from('reservations')
          .update({ status: 'confirmed' })
          .eq('id', resId);

        // If this reservation came from a waitlist offer, mark the waitlist
        // entry as converted so it leaves the waiting list for good.
        await supabase
          .from('waitlist_entries')
          .update({
            status: 'converted_to_booking',
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', tenant_id)
          .eq('matched_reservation_id', resId)
          .eq('status', 'offered');

        return NextResponse.json({ confirmed: true, reservation_id: resId });
      }
    }

    return NextResponse.json({ confirmed: false, message: "No pending reservation found" });
  } catch (error: any) {
    return apiError(error, { route: "ai/confirm-pending", publicMessage: "operation_failed", extra: { confirmed: false } });
  }
}
