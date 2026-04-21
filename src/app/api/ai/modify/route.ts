import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
import { assertAiSecret } from '@/lib/ai-auth';
import {
  getShift,
  getRotationMinutes,
  calculateEndTime,
  tablesNeeded,
} from '@/lib/restaurant-rules';

interface ModifyPayload {
  tenant_id: string;
  reservation_id?: string;
  guest_phone?: string;
  guest_name?: string;
  new_phone?: string;
  date?: string;
  time?: string;
  party_size?: number;
  notes?: string;
  // Optional incremental helpers — let the backend compute the absolute value
  // from the existing reservation (keeps the voice prompt simple).
  personas_delta?: number; // positive=add people, negative=remove
  retraso_minutos?: number; // delay to add to the original time
  idempotency_key?: string;
}

export async function PUT(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  try {
    const payload: ModifyPayload = await request.json();

    if (!payload.tenant_id || (!payload.reservation_id && !payload.guest_phone)) {
      return NextResponse.json({ success: false, error: "Missing tenant_id and reservation_id or guest_phone" }, { status: 400 });
    }

    // Bounds validation on optional delta helpers so the bot can't pass
    // absurd values (NaN, Infinity, huge deltas) and corrupt reservations.
    if (payload.personas_delta !== undefined) {
      if (!Number.isFinite(payload.personas_delta)) {
        return NextResponse.json({ success: false, error: 'personas_delta must be a finite number' }, { status: 400 });
      }
      if (Math.abs(payload.personas_delta) > 50) {
        return NextResponse.json({ success: false, error: 'personas_delta out of range (-50..50)' }, { status: 400 });
      }
    }
    if (payload.retraso_minutos !== undefined) {
      if (!Number.isFinite(payload.retraso_minutos)) {
        return NextResponse.json({ success: false, error: 'retraso_minutos must be a finite number' }, { status: 400 });
      }
      if (Math.abs(payload.retraso_minutos) > 8 * 60) {
        return NextResponse.json({ success: false, error: 'retraso_minutos out of range (-480..480)' }, { status: 400 });
      }
    }

    // Date/time format validation — avoid garbage like "mañana" or "20:00:00" reaching downstream SQL.
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const TIME_RE = /^\d{2}:\d{2}$/;
    if (payload.date && !DATE_RE.test(payload.date)) {
      return NextResponse.json({ success: false, error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (payload.time && !TIME_RE.test(payload.time)) {
      return NextResponse.json({ success: false, error: 'time must be HH:MM' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Idempotency short-circuit — if n8n retries the same modify (network blip)
    // the delta must not fire twice (+3 would become +6). We don't write the key
    // via logAuditEvent (audit.ts doesn't expose it on this code path) but we
    // check prior audit rows with a 10-minute window as a best-effort guard.
    if (payload.idempotency_key) {
      const { data: prior } = await supabase
        .from('audit_events')
        .select('entity_id, details')
        .eq('tenant_id', payload.tenant_id)
        .eq('idempotency_key', payload.idempotency_key)
        .eq('action', 'modify_reservation')
        .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(1);
      if (prior && prior.length > 0) {
        return NextResponse.json({
          success: true,
          message: 'Reservation modify already processed (idempotent)',
          reservation_id: prior[0].entity_id,
          idempotent: true,
        });
      }
    }

    // Find reservation by ID or by guest phone (most recent active)
    let reservationId = payload.reservation_id;

    if (!reservationId && payload.guest_phone) {
      const phoneDigits = payload.guest_phone.replace(/\D/g, '');
      const { data: guests } = await supabase
        .from('guests')
        .select('id, phone')
        .eq('tenant_id', payload.tenant_id);

      const matchingGuests = (guests || []).filter((g: any) => {
        const gDigits = (g.phone || '').replace(/\D/g, '');
        if (!gDigits || gDigits.length < 7) return false;
        return gDigits.includes(phoneDigits) || phoneDigits.includes(gDigits);
      });

      // Try each matching guest — find the most recent ACTIVE reservation (not completed/cancelled/no_show)
      for (const guest of matchingGuests) {
        const { data: resList } = await supabase
          .from('reservations')
          .select('id, date')
          .eq('tenant_id', payload.tenant_id)
          .eq('guest_id', guest.id)
          .in('status', ['confirmed', 'pending_confirmation', 'escalated', 'seated'])
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1);

        if (resList && resList.length > 0) {
          reservationId = resList[0].id;
          break;
        }
      }
    }

    if (!reservationId) {
      return NextResponse.json({ success: false, error: "No active reservation found" }, { status: 404 });
    }

    // Fetch existing reservation
    const { data: existing, error: fetchErr } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', reservationId)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ success: false, error: "Reservation not found" }, { status: 404 });
    }

    if (existing.tenant_id !== payload.tenant_id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
    }

    // Update guest name/phone if provided
    const guestUpdates: Record<string, string> = {};
    if (payload.guest_name) guestUpdates.name = payload.guest_name;
    if (payload.new_phone) guestUpdates.phone = payload.new_phone;
    if (Object.keys(guestUpdates).length > 0) {
      await supabase.from('guests').update(guestUpdates).eq('id', existing.guest_id);
    }

    // Build updates. If the bot passed `personas_delta` or `retraso_minutos`,
    // compute the absolute value from the existing reservation here so the
    // bot never has to do math. Absolute params (`party_size`, `time`) still
    // take precedence for backward compat.
    const newDate = payload.date || existing.date;
    let newTime = payload.time || existing.time;
    if (!payload.time && typeof payload.retraso_minutos === 'number' && payload.retraso_minutos !== 0) {
      const [hh, mm] = existing.time.split(':').map(Number);
      const total = hh * 60 + mm + payload.retraso_minutos;
      const clamped = Math.max(0, Math.min(total, 23 * 60 + 59));
      newTime = `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
    }
    let newPartySize = payload.party_size || existing.party_size;
    if (!payload.party_size && typeof payload.personas_delta === 'number' && payload.personas_delta !== 0) {
      newPartySize = Math.max(1, (existing.party_size || 0) + payload.personas_delta);
    }
    // Final clamp — defense in depth against degenerate absolute values too.
    newPartySize = Math.max(1, Math.min(50, newPartySize));
    const newShift = getShift(newTime);
    const dayOfWeek = new Date(newDate + 'T12:00:00').getDay();
    const rotation = getRotationMinutes(newPartySize, newShift, dayOfWeek);
    const newEndTime = calculateEndTime(newTime, rotation);

    const updates: Record<string, any> = {
      date: newDate,
      time: newTime,
      party_size: newPartySize,
      shift: newShift,
      end_time: newEndTime,
      updated_at: new Date().toISOString(),
    };

    // If the reservation was already seated/completed (staff had seated the
    // party for the ORIGINAL date) and the client is now moving it to a
    // different date/time, the reservation is effectively a fresh future
    // booking — it can't still be "seated". Reset to confirmed so the UI
    // shows red (occupied) instead of blue (seated).
    const movedToDifferentDay = payload.date && payload.date !== existing.date;
    const movedToDifferentTime = payload.time && payload.time !== existing.time;
    if ((movedToDifferentDay || movedToDifferentTime) &&
        (existing.status === 'seated' || existing.status === 'completed')) {
      updates.status = 'confirmed';
    }

    if (payload.notes !== undefined) {
      // Overwrite with incoming notes, preserving the "Prefiere interior/exterior"
      // zone marker automatically added at booking time if the new notes omit it.
      let nextNotes = (payload.notes || '').trim();
      const zoneRe = /Prefiere\s+(interior|exterior)/i;
      const existingZoneMatch = existing.notes ? String(existing.notes).match(zoneRe) : null;
      if (existingZoneMatch && !zoneRe.test(nextNotes)) {
        nextNotes = nextNotes
          ? `${nextNotes} — ${existingZoneMatch[0]}`
          : existingZoneMatch[0];
      }
      updates.notes = nextNotes;
    }

    // If the new party_size becomes a large group (7+), force re-review
    // so the owner can re-confirm in real time. Skip if it was already a large group.
    const becameLargeGroup = newPartySize >= 7 && existing.party_size < 7;
    if (becameLargeGroup) {
      updates.status = 'escalated';
      const reviewNote = 'GRUPO MODIFICADO A ' + newPartySize + ' PERSONAS — REVISAR';
      updates.notes = updates.notes ? `${updates.notes} — ${reviewNote}` : reviewNote;
    }

    // Update the reservation
    const { error: updateErr } = await supabase
      .from('reservations')
      .update(updates)
      .eq('id', reservationId);

    if (updateErr) throw updateErr;

    // Reassign tables if date, time, or party_size changed
    const dateChanged = newDate !== existing.date;
    const timeChanged = newTime !== existing.time;
    const sizeChanged = newPartySize !== existing.party_size;
    const shiftChanged = newShift !== (existing.shift || getShift(existing.time));

    let tablesAssigned: string[] = [];

    if (dateChanged || shiftChanged || sizeChanged) {
      // Seat-aware pre-check: before wiping the current assignment, verify
      // there are enough seats in the target shift to fit the new party.
      // Otherwise a 20→23 "+3" modification would silently reassign to
      // tables that only seat 20 again.
      const { data: activeTbls } = await supabase
        .from('restaurant_tables')
        .select('id, zone, seats')
        .eq('tenant_id', payload.tenant_id)
        .eq('status', 'active');

      const { data: sameDayRes } = await supabase
        .from('reservations')
        .select('id, time, shift, status')
        .eq('tenant_id', payload.tenant_id)
        .eq('date', newDate)
        .in('status', ['confirmed', 'seated', 'pending_confirmation', 'escalated'])
        .neq('id', reservationId);

      const sameShiftIds = (sameDayRes || [])
        .filter((r: any) => (r.shift || getShift(r.time)) === newShift)
        .map((r: any) => r.id);

      let occupiedTableIds = new Set<string>();
      if (sameShiftIds.length > 0) {
        const { data: links } = await supabase
          .from('reservation_tables')
          .select('reservation_id, table_id')
          .in('reservation_id', sameShiftIds);
        occupiedTableIds = new Set((links || []).map((l: any) => l.table_id));
      }

      const freeSeatsByZone: Record<string, number> = { inside: 0, outside: 0 };
      for (const t of (activeTbls || []) as any[]) {
        if (occupiedTableIds.has(t.id)) continue;
        if (t.zone === 'inside' || t.zone === 'outside') freeSeatsByZone[t.zone] += (t.seats || 0);
      }
      const totalFreeSeats = freeSeatsByZone.inside + freeSeatsByZone.outside;

      // Detect the reservation's ORIGINAL zone so a modification never
      // auto-switches the client from outside to inside (or vice versa).
      // Source of truth: the zone of the currently assigned tables.
      // Fallback: "Prefiere interior|exterior" marker in notes.
      let originalZone: 'inside' | 'outside' | null = null;
      const { data: currentAssignments } = await supabase
        .from('reservation_tables')
        .select('table_id')
        .eq('reservation_id', reservationId);
      const currentTableIds = new Set((currentAssignments || []).map((r: any) => r.table_id));
      if (currentTableIds.size > 0) {
        const zonesSeen = new Set<string>();
        for (const t of (activeTbls || []) as any[]) {
          if (currentTableIds.has(t.id) && (t.zone === 'inside' || t.zone === 'outside')) {
            zonesSeen.add(t.zone);
          }
        }
        if (zonesSeen.size === 1) {
          const z = Array.from(zonesSeen)[0];
          if (z === 'inside' || z === 'outside') originalZone = z;
        }
      }
      if (!originalZone && existing.notes) {
        const m = String(existing.notes).match(/Prefiere\s+(interior|exterior)/i);
        if (m) {
          originalZone = m[1].toLowerCase() === 'interior' ? 'inside' : 'outside';
        }
      }

      if (totalFreeSeats < newPartySize) {
        // Rollback the partial update (revert party_size/date/time) so the
        // UI stays in a consistent state, then escalate.
        await supabase.from('reservations').update({
          status: 'escalated',
          notes: `${updates.notes || existing.notes || ''} — Sin capacidad tras modificación (${newPartySize} pax, ${totalFreeSeats} plazas libres)`.trim(),
        }).eq('id', reservationId);

        return NextResponse.json({
          success: false,
          reservation_id: reservationId,
          status: 'escalated',
          new_party_size: newPartySize,
          free_seats: totalFreeSeats,
          free_seats_inside: freeSeatsByZone.inside,
          free_seats_outside: freeSeatsByZone.outside,
          error: `No hay plazas suficientes para ${newPartySize} personas en ese turno (plazas libres: ${totalFreeSeats}).`,
          message: `No hay plazas suficientes para ${newPartySize} personas en ese turno. Hay ${totalFreeSeats} plazas libres. Dejamos la reserva pendiente de revisión.`,
        }, { status: 409 });
      }

      // Zone preservation: if the reservation was booked in a specific zone
      // and the modification doesn't fit THAT zone (even if the other zone
      // has space), escalate for manual review instead of silently moving
      // the guest to the other zone.
      if (originalZone && freeSeatsByZone[originalZone] < newPartySize) {
        const zoneEs = originalZone === 'inside' ? 'interior' : 'exterior';
        const zoneOtherEs = originalZone === 'inside' ? 'exterior' : 'interior';
        const noteMismatch = `Ampliación a ${newPartySize} pax no cabe en ${zoneEs} (plazas libres: ${freeSeatsByZone[originalZone]}). En ${zoneOtherEs} hay ${freeSeatsByZone[originalZone === 'inside' ? 'outside' : 'inside']} plazas. Llamar al cliente para acordar.`;
        await supabase.from('reservations').update({
          status: 'escalated',
          notes: `${updates.notes || existing.notes || ''} — ${noteMismatch}`.trim(),
        }).eq('id', reservationId);

        return NextResponse.json({
          success: false,
          reservation_id: reservationId,
          status: 'escalated',
          new_party_size: newPartySize,
          zone_requested: originalZone,
          zone_requested_available: false,
          zone_alternative: originalZone === 'inside' ? 'outside' : 'inside',
          zone_alternative_available: freeSeatsByZone[originalZone === 'inside' ? 'outside' : 'inside'] >= newPartySize,
          free_seats_inside: freeSeatsByZone.inside,
          free_seats_outside: freeSeatsByZone.outside,
          error: `No hay plazas en ${zoneEs} para ampliar a ${newPartySize} personas.`,
          message: `No hay plazas en ${zoneEs} para ${newPartySize} personas. Dejamos la reserva en solicitudes para que el responsable llame al cliente.`,
        }, { status: 409 });
      }

      // Remove old table assignments and let atomic_book_tables decide
      // the new optimal assignment within the original zone (preserves
      // the client's zone choice). Falls back to any zone only when
      // the original zone is unknown.
      await supabase.from('reservation_tables').delete().eq('reservation_id', reservationId);

      const { data: atomicResult, error: atomicErr } = await supabase.rpc('atomic_book_tables', {
        p_tenant_id: payload.tenant_id,
        p_date: newDate,
        p_shift: newShift,
        p_tables_needed: tablesNeeded(newPartySize),
        p_reservation_id: reservationId,
        p_zone_preference: originalZone,
      });

      if (atomicErr) throw atomicErr;

      if (!atomicResult?.success) {
        // Not enough capacity — escalate
        await supabase.from('reservations').update({
          status: 'escalated',
          notes: `${updates.notes || existing.notes || ''}\nNo hay mesas disponibles tras modificación`.trim(),
        }).eq('id', reservationId);

        await logAuditEvent({
          tenant_id: payload.tenant_id,
          action: "modify_reservation",
          entity_id: reservationId,
          idempotency_key: payload.idempotency_key,
          source: "ai_agent",
          details: { previous: { date: existing.date, time: existing.time, party_size: existing.party_size }, updates, escalated: true },
        });

        return NextResponse.json({
          success: true,
          reservation_id: reservationId,
          status: 'escalated',
          shift: newShift,
          end_time: newEndTime,
          tables_assigned: [],
          message: `Reserva modificada pero no hay capacidad suficiente. Pendiente de revisión.`,
        });
      }

      tablesAssigned = atomicResult.tables_assigned || [];
    } else {
      // No table reassignment needed — keep existing tables
      const { data: currentLinks } = await supabase
        .from('reservation_tables')
        .select('restaurant_tables(name)')
        .eq('reservation_id', reservationId);
      tablesAssigned = (currentLinks || []).map((l: any) => l.restaurant_tables?.name).filter(Boolean);
    }

    await logAuditEvent({
      tenant_id: payload.tenant_id,
      action: "modify_reservation",
      entity_id: reservationId,
      idempotency_key: payload.idempotency_key,
      source: "ai_agent",
      details: {
        previous: { date: existing.date, time: existing.time, party_size: existing.party_size, shift: existing.shift },
        updates,
        tables_assigned: tablesAssigned,
      }
    });

    return NextResponse.json({
      success: true,
      reservation_id: reservationId,
      status: becameLargeGroup ? 'escalated' : existing.status,
      shift: newShift,
      end_time: newEndTime,
      tables_assigned: tablesAssigned,
      requires_review: becameLargeGroup,
      previous_party_size: existing.party_size,
      new_party_size: newPartySize,
      final_date: newDate,
      final_time: newTime,
      message: becameLargeGroup
        ? `Reserva modificada a ${newPartySize} personas — pendiente de revisión por ser grupo grande.`
        : "Reserva modificada correctamente."
    });

  } catch (error: any) {
    console.error("Modify Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
