import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CreateBookingRequest } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';
import { logSystemEvent } from '@/lib/system-log';
import { assertAiSecret } from '@/lib/ai-auth';
import { dispatchAutomations } from '@/lib/automations/engine';
import {
  getShift,
  getRotationMinutes,
  calculateEndTime,
  tablesNeeded,
  getBookingAction,
  type OpeningHours,
} from '@/lib/restaurant-rules';
import {
  isDate,
  isTime,
  isE164,
  normalizeZone,
  nowInCanary,
  checkPast,
  checkOpeningHours,
} from '@/lib/booking-validation';
import { assertRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  const rl = await assertRateLimit(request, 'ai:book', { max: 30, windowSecs: 60 });
  if (rl) return rl;
  try {
    const payload: CreateBookingRequest = await request.json();

    if (!payload.tenant_id || !payload.idempotency_key || !payload.date || !payload.time || !payload.party_size) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Date/time format validation — avoid garbage reaching downstream SQL.
    if (!isDate(payload.date)) {
      return NextResponse.json({ success: false, error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!isTime(payload.time)) {
      return NextResponse.json({ success: false, error: 'time must be HH:MM' }, { status: 400 });
    }

    // Past-date/time guard — defense in depth. Wrappers (voice/chat) filter
    // this client-side, but the API must also refuse so a malformed tool call
    // can't create yesterday's reservation (or today's 20:00 booking at 22:00)
    // and silently pollute analytics + no-show workflows.
    const _canary = nowInCanary();
    const _pastKind = checkPast(payload.date, payload.time, _canary.todayYmd, _canary.hours, _canary.minutes);
    if (_pastKind === 'past_date') {
      return NextResponse.json({
        success: false,
        reason: 'past_date',
        message: `No se puede reservar para una fecha pasada (${payload.date}). ¿Para qué día quieres reservar?`,
      }, { status: 409 });
    }
    if (_pastKind === 'past_time') {
      return NextResponse.json({
        success: false,
        reason: 'past_time',
        message: `A las ${payload.time} de hoy ya ha pasado. ¿Para qué hora (futura) quieres reservar?`,
      }, { status: 409 });
    }

    // E.164 phone validation — optional leading "+", 7-15 digits, first non-zero
    if (payload.guest_phone !== undefined && payload.guest_phone !== null) {
      const phoneStr = String(payload.guest_phone).trim();
      if (phoneStr.length > 0 && !isE164(phoneStr)) {
        return NextResponse.json(
          { success: false, error: "Invalid guest_phone format — expected E.164 (e.g. +34612345678)" },
          { status: 400 }
        );
      }
    }

    // Check party size rules — 7+ always goes to manual review (escalated), never reject
    const action = getBookingAction(payload.party_size);
    if (action === 'reject' || action === 'manual_review') {
      // Force manual review path for any group 7+
    }

    const supabase = createServiceRoleClient();

    // 0–2. Three independent reads up front — tenant settings (for opening
    // hours), idempotency check, and existing-guest lookup. Run in parallel
    // (~10ms wall-clock vs ~30ms sequential). Each result still falls back
    // to its sequential validation branch below.
    const [tenantRes, idempotencyRes, existingGuestsRes] = await Promise.all([
      supabase
        .from('tenants')
        .select('settings')
        .eq('id', payload.tenant_id)
        .maybeSingle(),
      supabase
        .from('audit_events')
        .select('entity_id')
        .eq('tenant_id', payload.tenant_id)
        .eq('idempotency_key', payload.idempotency_key)
        .eq('action', 'create_reservation')
        .limit(1),
      supabase
        .from('guests')
        .select('id, name')
        .eq('tenant_id', payload.tenant_id)
        .eq('phone', payload.guest_phone)
        .limit(1),
    ]);

    // 0. Opening-hours guard — reject bookings on closed days or outside opening slots.
    // Same source of truth as /api/ai/availability: tenants.settings.opening_hours.
    {
      const tenantRow = tenantRes.data;
      const openingHours: OpeningHours = ((tenantRow?.settings as unknown) as { opening_hours?: OpeningHours })?.opening_hours || {};
      const ohResult = checkOpeningHours(payload.date, payload.time, openingHours);
      if (!ohResult.ok && ohResult.reason === 'closed_day') {
        const nextLabel = ohResult.nextOpen ? ` Abrimos el ${ohResult.nextOpen.weekday}.` : '';
        return NextResponse.json({
          success: false,
          reason: 'closed_day',
          message: `El restaurante está cerrado el ${payload.date}.${nextLabel} ¿Quieres reservar para otro día?`,
        }, { status: 409 });
      }
      if (!ohResult.ok && ohResult.reason === 'outside_hours') {
        return NextResponse.json({
          success: false,
          reason: 'outside_hours',
          message: `A las ${payload.time} el restaurante está cerrado. Ese día abrimos: ${ohResult.hoursToday}. ¿Quieres cambiar la hora?`,
        }, { status: 409 });
      }
    }

    // 1. Idempotency Check
    const existingChecks = idempotencyRes.data;

    if (existingChecks && existingChecks.length > 0) {
       return NextResponse.json({
          success: true,
          message: "Reservation already exists (Idempotent response)",
          reservation_id: existingChecks[0].entity_id
       });
    }

    // 2. Guest Verification / Creation
    let guestId: string;
    const existingGuests = existingGuestsRes.data;

    if (existingGuests && existingGuests.length > 0) {
       guestId = existingGuests[0].id;
       // Update guest name when the (authenticated) caller provides a real
       // name — even if a previous real name is already stored. Keeps the
       // CRM in sync with the name the client gave in the latest call
       // (e.g. "Stewart" replacing an older "Juan" on the same phone).
       // Protection against malicious overwrite is the C1 shared-secret
       // auth header, not a write-lock on the guest name.
       const newName = (payload.guest_name || '').trim();
       const isPlaceholder = !newName || newName === 'Unknown Guest' || newName === 'Cliente';
       if (!isPlaceholder && existingGuests[0].name !== newName) {
         await supabase.from('guests').update({ name: newName }).eq('id', guestId);
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

    // 2b. Duplicate-intent guard — the voice bot sometimes calls book_table
    // when the caller wanted to MODIFY an existing booking. Before creating
    // a new reservation, check whether the same guest already has an active
    // reservation within ±3 days of the requested date. If so, return 409
    // with enough detail for the bot to ask "new booking or modification?".
    // The bot can re-send with `force_new: true` if the customer confirms.
    if (!payload.force_new) {
      const reqDate = new Date(payload.date + 'T12:00:00');
      const winStart = new Date(reqDate); winStart.setDate(winStart.getDate() - 3);
      const winEnd = new Date(reqDate); winEnd.setDate(winEnd.getDate() + 3);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const { data: nearby } = await supabase
        .from('reservations')
        .select('id, date, time, party_size, status')
        .eq('tenant_id', payload.tenant_id)
        .eq('guest_id', guestId)
        .in('status', ['confirmed', 'seated', 'pending_confirmation', 'escalated'])
        .gte('date', fmt(winStart))
        .lte('date', fmt(winEnd))
        .order('date', { ascending: true });

      if (nearby && nearby.length > 0) {
        const summary = nearby.map((r: any) => `${r.date} ${r.time} (${r.party_size} pax)`).join(', ');
        // Return 200 (not 409) so n8n httpRequest doesn't throw — keeps the
        // structured response (reason, existing_reservations, message)
        // reachable by the bot instead of surfacing as "problema técnico".
        return NextResponse.json({
          success: false,
          reason: 'possible_duplicate',
          // Sanitized — expose only the fields the bot needs (no id/status/guest_id)
          existing_reservations: nearby.map((r: any) => ({
            date: r.date,
            time: r.time,
            party_size: r.party_size,
          })),
          message: `El cliente ya tiene ${nearby.length === 1 ? 'una reserva activa' : nearby.length + ' reservas activas'}: ${summary}. Pregúntale si quiere MODIFICAR esa reserva (usa modify_reservation) o crear una NUEVA adicional (llama otra vez book_table con force_new=true).`,
        });
      }
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

    // Normalize zone preference (accepts inside/outside, fuera/dentro, etc.)
    const zonePref = normalizeZone(payload.zone || payload.zone_preference);
    const zoneNote = zonePref ? `Prefiere ${zonePref === 'inside' ? 'interior' : 'exterior'}` : '';

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
      // Per-zone capacity so the bot can honour the client's zone preference
      // for large groups too (no auto-switch).
      const freeSeatsByZoneLG: Record<string, number> = { inside: 0, outside: 0 };
      for (const t of freeTables as any[]) {
        if (t.zone === 'inside' || t.zone === 'outside') freeSeatsByZoneLG[t.zone] += (t.seats || 0);
      }
      const freeSeats = freeSeatsByZoneLG.inside + freeSeatsByZoneLG.outside;
      const hasCapacity = freeSeats >= payload.party_size;

      // Client asked for a specific zone that can't fit but the OTHER one can.
      // Don't create the reservation — return a prompt so the bot asks the caller.
      if (hasCapacity && (zonePref === 'inside' || zonePref === 'outside')) {
        if (freeSeatsByZoneLG[zonePref] < payload.party_size) {
          const other = zonePref === 'inside' ? 'outside' : 'inside';
          if (freeSeatsByZoneLG[other] >= payload.party_size) {
            return NextResponse.json({
              success: true,
              zone_requested: zonePref,
              zone_requested_available: false,
              zone_alternative: other,
              zone_alternative_available: true,
              free_seats_inside: freeSeatsByZoneLG.inside,
              free_seats_outside: freeSeatsByZoneLG.outside,
              party_size: payload.party_size,
              message: `No hay plazas en ${zonePref === 'inside' ? 'interior' : 'exterior'} para ${payload.party_size} personas. Sí hay disponibilidad en ${other === 'inside' ? 'interior' : 'exterior'} — preguntar al cliente si le va bien esa zona.`
            });
          }
        }
      }

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
            notes: [(payload.notes || ''), zoneNote, 'Sin plazas disponibles en el turno, añadido a lista de espera'].filter(Boolean).join(' — '),
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
        from_web: payload.from_web === true,
        created_by_type: 'ai',
        notes: zoneNote
          ? `${payload.notes || ''}${payload.notes ? ' — ' : ''}${zoneNote}`.trim()
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

    // 6. Normal booking (1-6 people) - create reservation then atomically assign tables
    const bookingLang = payload.language;
    const reservation: Record<string, any> = {
       tenant_id: payload.tenant_id,
       guest_id: guestId,
       date: payload.date,
       time: payload.time,
       party_size: payload.party_size,
       status: payload.status || 'confirmed',
       source: payload.source || 'ai_voice',
       from_web: payload.from_web === true,
       created_by_type: 'ai',
       // Don't auto-add "Prefiere X" here — the assigned tables already
       // encode the zone. The marker is only useful for waitlist/escalated
       // entries where tables aren't assigned yet.
       notes: payload.notes || '',
       linked_conversation_id: payload.linked_conversation_id,
       end_time: endTime,
       shift,
    };
    // Pin the customer's language to THIS reservation. The reminder cron
    // reads reservations.language so different bookings from the same phone
    // can have different languages (e.g. user tests IT and ES from same line).
    if (bookingLang && ['es', 'it', 'en', 'de'].includes(bookingLang)) {
      reservation.language = bookingLang;
    }

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
    } else {
      // No client preference — best-fit across zones: pick the zone whose
      // smallest single free table ≥ party_size is the smallest (minimize
      // wasted seats). Fall back to any zone with enough combined capacity.
      // Tiebreak: inside first.
      const smallestFitByZone: Record<'inside' | 'outside', number | null> = { inside: null, outside: null };
      for (const t of (activeTables || []) as any[]) {
        if (occupiedTableIds.has(t.id)) continue;
        const tz: 'inside' | 'outside' | null = t.zone === 'inside' ? 'inside' : t.zone === 'outside' ? 'outside' : null;
        if (!tz) continue;
        const seats = t.seats || 0;
        if (seats < payload.party_size) continue;
        if (smallestFitByZone[tz] === null || seats < (smallestFitByZone[tz] as number)) {
          smallestFitByZone[tz] = seats;
        }
      }
      if (smallestFitByZone.inside !== null && smallestFitByZone.outside !== null) {
        requestedZone = smallestFitByZone.inside <= smallestFitByZone.outside ? 'inside' : 'outside';
      } else if (smallestFitByZone.inside !== null) {
        requestedZone = 'inside';
      } else if (smallestFitByZone.outside !== null) {
        requestedZone = 'outside';
      } else if (freeSeatsByZone.inside >= payload.party_size) {
        requestedZone = 'inside';
      } else if (freeSeatsByZone.outside >= payload.party_size) {
        requestedZone = 'outside';
      }
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
          notes: [(payload.notes || ''), zoneNote, 'Sin plazas disponibles en la zona, añadido a lista de espera'].filter(Boolean).join(' — '),
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
          notes: [(payload.notes || ''), zoneNote, 'Sin plazas al confirmar, añadido a lista de espera'].filter(Boolean).join(' — '),
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

    // Fire automations (fire-and-forget)
    after(async () => {
      await dispatchAutomations({
        trigger: "on_reservation_created",
        tenantId: payload.tenant_id,
        reservationId: newRes.id,
        guestId,
        guestName: payload.guest_name,
        guestPhone: payload.guest_phone,
        date: payload.date,
        time: payload.time,
        partySize: payload.party_size,
        status: "confirmed",
        source: payload.source || "ai_voice",
        shift,
        notes: payload.notes,
      });
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
