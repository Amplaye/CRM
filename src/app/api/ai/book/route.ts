import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CreateBookingRequest } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';
import { logSystemEvent } from '@/lib/system-log';
import {
  getShift,
  getRotationMinutes,
  calculateEndTime,
  tablesNeeded,
  getBookingAction,
} from '@/lib/restaurant-rules';

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const a0 = timeToMinutes(startA);
  const a1 = timeToMinutes(endA);
  const b0 = timeToMinutes(startB);
  const b1 = timeToMinutes(endB);
  return a0 < b1 && b0 < a1;
}

export async function POST(request: Request) {
  try {
    const payload: CreateBookingRequest = await request.json();

    if (!payload.tenant_id || !payload.idempotency_key || !payload.date || !payload.time || !payload.party_size) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Check party size rules — 7+ always goes to manual review (escalated), never reject
    const action = getBookingAction(payload.party_size);
    if (action === 'reject' || action === 'manual_review') {
      // Force manual review path for any group 7+
    }

    const supabase = createServiceRoleClient();

    // 1. Idempotency Check
    const { data: existingChecks } = await supabase
       .from('audit_events')
       .select('entity_id')
       .eq('tenant_id', payload.tenant_id)
       .eq('idempotency_key', payload.idempotency_key)
       .eq('action', 'create_reservation')
       .limit(1);

    if (existingChecks && existingChecks.length > 0) {
       return NextResponse.json({
          success: true,
          message: "Reservation already exists (Idempotent response)",
          reservation_id: existingChecks[0].entity_id
       });
    }

    // 2. Guest Verification / Creation
    let guestId: string;
    const { data: existingGuests } = await supabase
      .from('guests')
      .select('id, name')
      .eq('tenant_id', payload.tenant_id)
      .eq('phone', payload.guest_phone)
      .limit(1);

    if (existingGuests && existingGuests.length > 0) {
       guestId = existingGuests[0].id;
       // Always update guest name if provided and different
       if (payload.guest_name && payload.guest_name !== "Unknown Guest" && payload.guest_name !== "Cliente" && existingGuests[0].name !== payload.guest_name) {
         await supabase.from('guests').update({ name: payload.guest_name }).eq('id', guestId);
       }
    } else {
       const { data: newGuest, error: guestErr } = await supabase
         .from('guests')
         .insert({
            tenant_id: payload.tenant_id,
            phone: payload.guest_phone,
            name: payload.guest_name || "Unknown Guest",
            visit_count: 0,
            no_show_count: 0,
            cancellation_count: 0,
            tags: [],
            notes: "",
         })
         .select('id')
         .single();

       if (guestErr) throw guestErr;
       guestId = newGuest.id;
    }

    // 3. Calculate shift and end_time
    const shift = getShift(payload.time);
    const dayOfWeek = new Date(payload.date + 'T12:00:00').getDay();
    const rotation = getRotationMinutes(payload.party_size, shift, dayOfWeek);
    const endTime = calculateEndTime(payload.time, rotation);
    const needed = tablesNeeded(payload.party_size);

    // 4. Find free tables for the time window
    const { data: activeTables, error: tablesErr } = await supabase
      .from('restaurant_tables')
      .select('id, name, zone, seats')
      .eq('tenant_id', payload.tenant_id)
      .eq('status', 'active');

    if (tablesErr) throw tablesErr;

    // Get existing reservations that overlap
    const { data: existingRes, error: resErr } = await supabase
      .from('reservations')
      .select('id, time, party_size, end_time, shift')
      .eq('tenant_id', payload.tenant_id)
      .eq('date', payload.date)
      .in('status', ['confirmed', 'seated', 'pending_confirmation', 'escalated']);

    if (resErr) throw resErr;

    const resIds = (existingRes || []).map((r: any) => r.id);
    let reservationTableMap: Record<string, string[]> = {};

    if (resIds.length > 0) {
      const { data: resTables } = await supabase
        .from('reservation_tables')
        .select('reservation_id, table_id')
        .in('reservation_id', resIds);

      for (const rt of (resTables || [])) {
        if (!reservationTableMap[rt.reservation_id]) {
          reservationTableMap[rt.reservation_id] = [];
        }
        reservationTableMap[rt.reservation_id].push(rt.table_id);
      }
    }

    // Find occupied table IDs for the same shift
    // Tables are occupied for the ENTIRE shift (customers can stay as long as they want)
    const occupiedTableIds = new Set<string>();
    for (const res of (existingRes || [])) {
      const resShift = res.shift || getShift(res.time);
      // A table is occupied if it belongs to any reservation in the same shift
      if (resShift === shift) {
        const assigned = reservationTableMap[res.id] || [];
        for (const tid of assigned) {
          occupiedTableIds.add(tid);
        }
      }
    }

    // 5. Handle manual review (7-12 people) - check capacity first
    if (action === 'manual_review' || action === 'reject') {
      const freeTables = (activeTables || []).filter((t: any) => !occupiedTableIds.has(t.id));
      const freeSeats = freeTables.reduce((s: number, t: any) => s + (t.seats || 0), 0);
      const hasCapacity = freeSeats >= payload.party_size;

      // No seats → add to waitlist instead of escalated (owner can't assign tables that don't exist)
      if (!hasCapacity) {
        const { data: newWait, error: waitErr } = await supabase
          .from('waitlist_entries')
          .insert({
            tenant_id: payload.tenant_id,
            guest_id: guestId,
            date: payload.date,
            target_time: payload.time,
            party_size: payload.party_size,
            status: 'waiting',
            contact_preference: payload.source === 'ai_voice' ? 'call' : 'whatsapp',
            priority_score: 50,
            acceptable_time_range: { start: payload.time, end: payload.time },
            notes: (payload.notes || "") + " — Sin plazas disponibles en el turno, añadido a lista de espera",
          })
          .select('id')
          .single();

        if (waitErr) throw waitErr;

        await logAuditEvent({
          tenant_id: payload.tenant_id,
          action: "create_waitlist",
          entity_id: newWait.id,
          idempotency_key: payload.idempotency_key,
          source: "ai_agent",
          details: { reason: "no_seats_large_group", party_size: payload.party_size, free_seats: freeSeats, shift },
        });

        return NextResponse.json({
          success: true,
          on_waitlist: true,
          waitlist_id: newWait.id,
          status: 'waitlist',
          has_capacity: false,
          free_seats: freeSeats,
          party_size: payload.party_size,
          shift,
          message: `No hay plazas suficientes para ${payload.party_size} personas en ese turno (plazas libres: ${freeSeats}). Te añadimos a la lista de espera y te avisamos si se libera sitio.`
        });
      }

      const reservation = {
        tenant_id: payload.tenant_id,
        guest_id: guestId,
        date: payload.date,
        time: payload.time,
        party_size: payload.party_size,
        status: 'escalated',
        source: payload.source || 'ai_voice',
        from_web: (payload as any).from_web === true,
        created_by_type: 'ai',
        notes: payload.notes || "",
        linked_conversation_id: payload.linked_conversation_id,
        end_time: endTime,
        shift,
      };

      const { data: newRes, error: newResErr } = await supabase
        .from('reservations')
        .insert(reservation)
        .select('id')
        .single();

      if (newResErr) throw newResErr;

      await logAuditEvent({
        tenant_id: payload.tenant_id,
        action: "create_reservation",
        entity_id: newRes.id,
        idempotency_key: payload.idempotency_key,
        source: "ai_agent",
        details: {
          date: payload.date,
          time: payload.time,
          party_size: payload.party_size,
          shift,
          type: "manual_review",
          has_capacity: hasCapacity,
          free_seats: freeSeats,
          free_tables: freeTables.length,
        }
      });

      return NextResponse.json({
        success: true,
        reservation_id: newRes.id,
        status: 'escalated',
        has_capacity: true,
        free_seats: freeSeats,
        free_tables: freeTables.length,
        shift,
        end_time: endTime,
        tables_assigned: [],
        message: "Solicitud registrada. Pendiente de revisión del responsable."
      });
    }

    // Normalize zone preference: accept inside/outside, fuera/dentro, etc.
    function normalizeZone(z: any): string | null {
      if (!z || typeof z !== 'string') return null;
      const v = z.toLowerCase().trim();
      if (v.includes('inside') || v.includes('interior') || v.includes('dentro') || v.includes('interno')) return 'inside';
      if (v.includes('outside') || v.includes('exterior') || v.includes('fuera') || v.includes('terraza') || v.includes('terrazza') || v.includes('outdoor') || v === 'out') return 'outside';
      return null;
    }
    const zonePref = normalizeZone((payload as any).zone || (payload as any).zone_preference);

    // 6. Normal booking (1-6 people) - create reservation then atomically assign tables
    const reservation = {
       tenant_id: payload.tenant_id,
       guest_id: guestId,
       date: payload.date,
       time: payload.time,
       party_size: payload.party_size,
       status: (payload as any).status || 'confirmed',
       source: payload.source || 'ai_voice',
       from_web: (payload as any).from_web === true,
       created_by_type: 'ai',
       notes: zonePref
         ? `${payload.notes || ''}${payload.notes ? ' — ' : ''}Prefiere ${zonePref === 'inside' ? 'interior' : 'exterior'}`.trim()
         : (payload.notes || ""),
       linked_conversation_id: payload.linked_conversation_id,
       end_time: endTime,
       shift,
    };

    const { data: newRes, error: newResErr } = await supabase
      .from('reservations')
      .insert(reservation)
      .select('id')
      .single();

    if (newResErr) throw newResErr;

    // Pre-compute free SEATS per zone. A reservation MUST live entirely in one
    // zone — never half inside and half outside. If neither zone alone has
    // enough seats, route to waitlist (not escalated).
    const freeSeatsByZone: Record<string, number> = { inside: 0, outside: 0 };
    for (const t of (activeTables || []) as any[]) {
      if (occupiedTableIds.has(t.id)) continue;
      if (t.zone === 'inside' || t.zone === 'outside') freeSeatsByZone[t.zone] += (t.seats || 0);
    }

    let requestedZone: 'inside' | 'outside' | null = null;
    if (zonePref === 'inside' || zonePref === 'outside') {
      // Honour the client's zone choice. If it doesn't fit, DO NOT auto-switch —
      // let the bot ask whether the other zone is acceptable.
      if (freeSeatsByZone[zonePref] >= payload.party_size) {
        requestedZone = zonePref;
      }
    } else if (freeSeatsByZone.inside >= payload.party_size) {
      requestedZone = 'inside';
    } else if (freeSeatsByZone.outside >= payload.party_size) {
      requestedZone = 'outside';
    }

    // Client asked for a specific zone that's full, but the OTHER zone has seats.
    // Don't book — ask the bot to offer the alternative to the client.
    if (!requestedZone && (zonePref === 'inside' || zonePref === 'outside')) {
      const other = zonePref === 'inside' ? 'outside' : 'inside';
      if (freeSeatsByZone[other] >= payload.party_size) {
        await supabase.from('reservations').delete().eq('id', newRes.id);
        return NextResponse.json({
          success: true,
          zone_requested: zonePref,
          zone_requested_available: false,
          zone_alternative: other,
          zone_alternative_available: true,
          free_seats_inside: freeSeatsByZone.inside,
          free_seats_outside: freeSeatsByZone.outside,
          party_size: payload.party_size,
          message: `No hay plazas en ${zonePref === 'inside' ? 'interior' : 'exterior'} para ${payload.party_size} personas. Sí hay disponibilidad en ${other === 'inside' ? 'interior' : 'exterior'} — preguntar al cliente si le va bien esa zona.`
        });
      }
    }

    // No single zone has enough seats → delete the tentative reservation and add to waitlist
    if (!requestedZone) {
      await supabase.from('reservations').delete().eq('id', newRes.id);

      const { data: newWait, error: waitErr } = await supabase
        .from('waitlist_entries')
        .insert({
          tenant_id: payload.tenant_id,
          guest_id: guestId,
          date: payload.date,
          target_time: payload.time,
          party_size: payload.party_size,
          status: 'waiting',
          contact_preference: payload.source === 'ai_voice' ? 'call' : 'whatsapp',
          priority_score: 50,
          acceptable_time_range: { start: payload.time, end: payload.time },
          notes: (payload.notes || '') + ' — Sin plazas disponibles en la zona, añadido a lista de espera',
        })
        .select('id')
        .single();

      if (waitErr) throw waitErr;

      await logAuditEvent({
        tenant_id: payload.tenant_id, action: "create_waitlist",
        entity_id: newWait.id, idempotency_key: payload.idempotency_key,
        source: "ai_agent",
        details: {
          type: "no_capacity_single_zone",
          free_seats_inside: freeSeatsByZone.inside,
          free_seats_outside: freeSeatsByZone.outside,
          party_size: payload.party_size,
        }
      });

      return NextResponse.json({
        success: true,
        on_waitlist: true,
        waitlist_id: newWait.id,
        status: 'waitlist',
        has_capacity: false,
        free_seats_inside: freeSeatsByZone.inside,
        free_seats_outside: freeSeatsByZone.outside,
        party_size: payload.party_size,
        message: `No hay plazas suficientes para ${payload.party_size} personas en ninguna zona (interior: ${freeSeatsByZone.inside}, exterior: ${freeSeatsByZone.outside}). Te añadimos a la lista de espera y te avisamos si se libera sitio.`
      });
    }

    // Atomic table assignment — prevents double-booking under concurrent requests
    const { data: atomicResult, error: atomicErr } = await supabase.rpc('atomic_book_tables', {
      p_tenant_id: payload.tenant_id,
      p_date: payload.date,
      p_shift: shift,
      p_tables_needed: needed,
      p_reservation_id: newRes.id,
      p_zone_preference: requestedZone,
    });
    if (atomicErr) throw atomicErr;
    const assignedZone: 'inside' | 'outside' | null = atomicResult?.success ? requestedZone : null;

    if (!atomicResult.success) {
      // Race condition — seats got taken between pre-check and RPC. Drop reservation, add to waitlist.
      await supabase.from('reservations').delete().eq('id', newRes.id);

      const { data: newWait, error: waitErr } = await supabase
        .from('waitlist_entries')
        .insert({
          tenant_id: payload.tenant_id,
          guest_id: guestId,
          date: payload.date,
          target_time: payload.time,
          party_size: payload.party_size,
          status: 'waiting',
          contact_preference: payload.source === 'ai_voice' ? 'call' : 'whatsapp',
          priority_score: 50,
          acceptable_time_range: { start: payload.time, end: payload.time },
          notes: (payload.notes || '') + ' — Sin plazas al confirmar, añadido a lista de espera',
        })
        .select('id')
        .single();

      if (waitErr) throw waitErr;

      await logAuditEvent({
        tenant_id: payload.tenant_id, action: "create_waitlist",
        entity_id: newWait.id, idempotency_key: payload.idempotency_key,
        source: "ai_agent", details: { type: "no_capacity_race", free_seats: atomicResult.free_seats, party_size: payload.party_size }
      });

      return NextResponse.json({
        success: true,
        on_waitlist: true,
        waitlist_id: newWait.id,
        status: 'waitlist',
        has_capacity: false,
        free_seats: atomicResult.free_seats,
        party_size: payload.party_size,
        message: `No hay plazas suficientes en el turno. Te añadimos a la lista de espera y te avisamos si se libera sitio.`
      });
    }

    await logAuditEvent({
       tenant_id: payload.tenant_id,
       action: "create_reservation",
       entity_id: newRes.id,
       idempotency_key: payload.idempotency_key,
       source: "ai_agent",
       details: {
          date: payload.date,
          time: payload.time,
          party_size: payload.party_size,
          shift,
          end_time: endTime,
          tables_assigned: atomicResult.tables_assigned,
       }
    });

    return NextResponse.json({
       success: true,
       reservation_id: newRes.id,
       status: 'confirmed',
       shift,
       end_time: endTime,
       tables_assigned: atomicResult.tables_assigned,
       zone_assigned: assignedZone,
       message: "Reservation successfully created."
    });

  } catch (error: any) {
    console.error("Booking Error:", error);
    logSystemEvent({
      category: "booking_error",
      severity: "critical",
      title: "Booking creation failed",
      description: error.message,
    });
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
