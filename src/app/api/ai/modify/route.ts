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
  new_zone?: 'inside' | 'outside' | 'interior' | 'exterior';
  notes?: string;
  // Optional incremental helpers — let the backend compute the absolute value
  // from the existing reservation (keeps the voice prompt simple).
  personas_delta?: number; // positive=add people, negative=remove
  retraso_minutos?: number; // delay to add to the original time
  // Disambiguators — when a guest has multiple active bookings on the same phone
  // (regular customer who books often), pass any of these so the API picks the
  // RIGHT reservation instead of "most recent" by chance.
  current_date?: string; // YYYY-MM-DD of the booking the client wants to modify
  current_time?: string; // HH:MM
  current_party_size?: number;
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
    if (payload.current_date && !DATE_RE.test(payload.current_date)) {
      return NextResponse.json({ success: false, error: 'current_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (payload.current_time && !TIME_RE.test(payload.current_time)) {
      return NextResponse.json({ success: false, error: 'current_time must be HH:MM' }, { status: 400 });
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

    // Find reservation by ID, or by guest phone with optional disambiguators
    // (current_date/current_time/current_party_size). When the guest is a
    // regular and has multiple active bookings on the same phone, the
    // disambiguators let us pick the EXACT reservation the client means
    // instead of guessing "most recent".
    let reservationId = payload.reservation_id;
    let ambiguousMatches: Array<{ id: string; date: string; time: string; party_size: number }> = [];

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

      // Collect ALL active reservations across the matching guests.
      const allActive: Array<{ id: string; date: string; time: string; party_size: number; created_at: string }> = [];
      for (const guest of matchingGuests) {
        const { data: resList } = await supabase
          .from('reservations')
          .select('id, date, time, party_size, created_at')
          .eq('tenant_id', payload.tenant_id)
          .eq('guest_id', guest.id)
          .in('status', ['confirmed', 'pending_confirmation', 'escalated', 'seated']);
        for (const r of resList || []) allActive.push(r as any);
      }

      // Score each reservation against the disambiguators. Exact matches on
      // date+time+party_size win; partial matches break ties; only when no
      // disambiguator is supplied (or all match the same one) do we fall back
      // to the most recent.
      const scored = allActive.map((r) => {
        let score = 0;
        if (payload.current_date && r.date === payload.current_date) score += 100;
        if (payload.current_time && (r.time || '').slice(0, 5) === payload.current_time) score += 50;
        if (payload.current_party_size && Number(r.party_size) === Number(payload.current_party_size)) score += 25;
        return { r, score };
      });
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Tiebreak: future dates first, then most recent created_at
        const aDate = a.r.date || '';
        const bDate = b.r.date || '';
        if (aDate !== bDate) return aDate > bDate ? -1 : 1;
        return (b.r.created_at || '') > (a.r.created_at || '') ? 1 : -1;
      });

      // Detect ambiguity: 2+ candidates tied at the top score AND the caller
      // gave no/insufficient disambiguators → return ambiguous response so the
      // bot can ask the client which one.
      if (scored.length > 1) {
        const topScore = scored[0].score;
        const tied = scored.filter((s) => s.score === topScore);
        const noDisambiguator = !payload.current_date && !payload.current_time && !payload.current_party_size;
        if (tied.length > 1 && (noDisambiguator || topScore < 100)) {
          ambiguousMatches = tied.map((s) => ({
            id: s.r.id,
            date: s.r.date,
            time: (s.r.time || '').slice(0, 5),
            party_size: s.r.party_size,
          }));
        }
      }

      if (ambiguousMatches.length === 0 && scored.length > 0) {
        reservationId = scored[0].r.id;
      }
    }

    if (ambiguousMatches.length > 1) {
      return NextResponse.json({
        success: false,
        reason: 'ambiguous_reservation',
        message: 'El cliente tiene varias reservas activas. Pregúntale para cuál es: ' +
          ambiguousMatches.map((m) => `${m.date} ${m.time} (${m.party_size}p)`).join(' · '),
        candidates: ambiguousMatches,
      }, { status: 409 });
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
      // Two modes:
      //   - 'append' (voice default): keep existing notes and add the new ones,
      //     skipping if the new chunk is already inside the existing notes.
      //     Voice agents don't know prior notes so the wrapper passes only what
      //     the caller said in this turn — losing existing context would be wrong.
      //   - 'replace' (chat default): the chat state machine already shows the
      //     full notes back to the LLM, so what comes in is the full intended set.
      //   Both modes always preserve the "Prefiere interior/exterior" marker.
      const mode = ((payload as any).notes_mode === 'append') ? 'append' : 'replace';
      const incoming = (payload.notes || '').trim();
      const existingNotes = existing.notes ? String(existing.notes).trim() : '';
      const zoneRe = /Prefiere\s+(interior|exterior)/i;
      const existingZoneMatch = existingNotes ? existingNotes.match(zoneRe) : null;

      let nextNotes: string;
      if (mode === 'append' && existingNotes) {
        // Strip the zone marker (we re-attach it later) and any leftover join
        // separators from older versions, so the merged output reads naturally.
        const stripped = existingNotes
          .replace(zoneRe, '')
          .replace(/\s+—\s+/g, '. ')
          .replace(/^[\s.—]+|[\s.—]+$/g, '')
          .trim();
        const joinSep = (s: string) => /[.!?]\s*$/.test(s) ? ' ' : '. ';
        if (incoming && !stripped.toLowerCase().includes(incoming.toLowerCase())) {
          nextNotes = stripped ? `${stripped}${joinSep(stripped)}${incoming}` : incoming;
        } else {
          nextNotes = stripped || incoming;
        }
      } else {
        nextNotes = incoming;
      }

      // Re-attach zone marker if it was there. Use a comma instead of " — "
      // to keep notes natural-looking (no AI-style em-dashes).
      if (existingZoneMatch && !zoneRe.test(nextNotes)) {
        nextNotes = nextNotes ? `${nextNotes}. ${existingZoneMatch[0]}` : existingZoneMatch[0];
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

    // Normalize requested zone (accept Spanish or English) and detect zone change.
    let requestedZone: 'inside' | 'outside' | null = null;
    if (payload.new_zone) {
      const z = String(payload.new_zone).toLowerCase();
      if (z === 'inside' || z === 'interior') requestedZone = 'inside';
      else if (z === 'outside' || z === 'exterior') requestedZone = 'outside';
    }

    let tablesAssigned: string[] = [];

    // Detect current zone now so we can decide if a zone change forces reassignment.
    let currentZone: 'inside' | 'outside' | null = null;
    {
      const { data: curLinks } = await supabase
        .from('reservation_tables')
        .select('table_id, restaurant_tables(zone)')
        .eq('reservation_id', reservationId);
      const zonesSeen = new Set<string>();
      for (const l of (curLinks || []) as any[]) {
        const z = l.restaurant_tables?.zone;
        if (z === 'inside' || z === 'outside') zonesSeen.add(z);
      }
      if (zonesSeen.size === 1) currentZone = Array.from(zonesSeen)[0] as 'inside' | 'outside';
    }
    const zoneChanged = !!(requestedZone && currentZone && requestedZone !== currentZone);

    if (dateChanged || shiftChanged || sizeChanged || zoneChanged) {
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

      // The client explicitly requested a zone switch — honor it. The notes
      // marker is rewritten below so future modifies/reads see the new zone.
      const targetZone: 'inside' | 'outside' | null = requestedZone || originalZone;

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
      if (targetZone && freeSeatsByZone[targetZone] < newPartySize) {
        const zoneEs = targetZone === 'inside' ? 'interior' : 'exterior';
        const zoneOtherEs = targetZone === 'inside' ? 'exterior' : 'interior';
        const noteMismatch = `Ampliación a ${newPartySize} pax no cabe en ${zoneEs} (plazas libres: ${freeSeatsByZone[targetZone]}). En ${zoneOtherEs} hay ${freeSeatsByZone[targetZone === 'inside' ? 'outside' : 'inside']} plazas. Llamar al cliente para acordar.`;
        await supabase.from('reservations').update({
          status: 'escalated',
          notes: `${updates.notes || existing.notes || ''} — ${noteMismatch}`.trim(),
        }).eq('id', reservationId);

        return NextResponse.json({
          success: false,
          reservation_id: reservationId,
          status: 'escalated',
          new_party_size: newPartySize,
          zone_requested: targetZone,
          zone_requested_available: false,
          zone_alternative: targetZone === 'inside' ? 'outside' : 'inside',
          zone_alternative_available: freeSeatsByZone[targetZone === 'inside' ? 'outside' : 'inside'] >= newPartySize,
          free_seats_inside: freeSeatsByZone.inside,
          free_seats_outside: freeSeatsByZone.outside,
          error: `No hay plazas en ${zoneEs} para ampliar a ${newPartySize} personas.`,
          message: `No hay plazas en ${zoneEs} para ${newPartySize} personas. Dejamos la reserva en solicitudes para que el responsable llame al cliente.`,
        }, { status: 409 });
      }

      // If the client requested a zone switch, rewrite the "Prefiere ..." marker
      // in notes so future reads (CRM UI, downstream modifies) see the new zone.
      // The outer reservations.update() already ran with the original notes, so
      // we need a second targeted update to persist the marker change.
      if (zoneChanged && requestedZone) {
        const newMarker = requestedZone === 'inside' ? 'Prefiere interior' : 'Prefiere exterior';
        const baseNotes = (updates.notes !== undefined ? updates.notes : (existing.notes || '')) as string;
        const stripped = String(baseNotes).replace(/Prefiere\s+(interior|exterior)/gi, '').replace(/\s+,\s+,/g, ',').replace(/^[\s,.\-—]+|[\s,.\-—]+$/g, '').trim();
        const nextNotes = stripped ? `${stripped}. ${newMarker}` : newMarker;
        updates.notes = nextNotes;
        await supabase.from('reservations').update({ notes: nextNotes }).eq('id', reservationId);
      }

      // Remove old table assignments and let atomic_book_tables decide
      // the new optimal assignment within the target zone (preserves the
      // client's choice or honors a freshly-requested zone switch).
      // Falls back to any zone only when no zone is known.
      await supabase.from('reservation_tables').delete().eq('reservation_id', reservationId);

      const { data: atomicResult, error: atomicErr } = await supabase.rpc('atomic_book_tables', {
        p_tenant_id: payload.tenant_id,
        p_date: newDate,
        p_shift: newShift,
        p_tables_needed: tablesNeeded(newPartySize),
        p_reservation_id: reservationId,
        p_zone_preference: targetZone,
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

    // Resolve final zone for the response (after any reassignment).
    let finalZone: 'inside' | 'outside' | null = null;
    {
      const { data: postLinks } = await supabase
        .from('reservation_tables')
        .select('restaurant_tables(zone)')
        .eq('reservation_id', reservationId);
      const zonesSeen = new Set<string>();
      for (const l of (postLinks || []) as any[]) {
        const z = l.restaurant_tables?.zone;
        if (z === 'inside' || z === 'outside') zonesSeen.add(z);
      }
      if (zonesSeen.size === 1) finalZone = Array.from(zonesSeen)[0] as 'inside' | 'outside';
    }

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
      final_zone: finalZone,
      message: becameLargeGroup
        ? `Reserva modificada a ${newPartySize} personas — pendiente de revisión por ser grupo grande.`
        : "Reserva modificada correctamente."
    });

  } catch (error: any) {
    console.error("Modify Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
