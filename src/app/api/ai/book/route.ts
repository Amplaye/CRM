import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CreateBookingRequest } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';
import { logSystemEvent, resolveSystemEvents } from '@/lib/system-log';
import { sendPushToTenant } from '@/lib/push/send';
import { assertAiSecret } from '@/lib/ai-auth';
import { assertActivePlan } from '@/lib/billing/guard';
import { formatDateFull } from '@/lib/format-date';
import { cleanGuestNotes, zoneTag } from '@/lib/reservation-notes';
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
  normalizePhone,
  phoneTail,
  normalizeZone,
  normalizeBookingSource,
  nowInCanary,
  checkPast,
  checkOpeningHours,
} from '@/lib/booking-validation';
import { assertRateLimit } from '@/lib/rate-limit';
import { getFeatures } from '@/lib/types/tenant-settings';
import { bookingVenueLines, type VenueInfo, type Lang } from '@/lib/onboarding/kb-generator';

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
        message: `No se puede reservar para una fecha pasada (${formatDateFull(payload.date, 'es')}). ¿Para qué día quieres reservar?`,
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

    // Canonical phone for storage + a tolerant tail for lookup. Meta delivers
    // the inbound number without a leading "+", so without this the same guest
    // was inserted twice ("34684109244" vs "+34684109244"). Store canonical,
    // match on the last 9 digits so an already-stored row (either format) wins.
    const canonicalPhone = normalizePhone(payload.guest_phone);
    const lookupTail = phoneTail(payload.guest_phone);

    const noPlan = await assertActivePlan(payload.tenant_id);
    if (noPlan) return noPlan;

    const supabase = createServiceRoleClient();

    // 0–2. Three independent reads up front — tenant settings (for opening
    // hours), idempotency check, and existing-guest lookup. Run in parallel
    // (~10ms wall-clock vs ~30ms sequential). Each result still falls back
    // to its sequential validation branch below.
    const [tenantRes, idempotencyRes, existingGuestsRes, convLangRes] = await Promise.all([
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
      // Tolerant guest lookup: fetch the tenant's guests and match on the last
      // 9 digits (E.164 subscriber part) so a row stored with OR without the
      // leading "+" is found — never create a duplicate for the same number.
      supabase
        .from('guests')
        .select('id, name, phone')
        .eq('tenant_id', payload.tenant_id),
      // Conversation language — the authoritative "language the customer used in
      // chat". The bot replies in (and tags the conversation with) the locked
      // session language, but the `language` it sends in THIS payload can be
      // stale on a fast turn (sticky-lang flush latency in n8n staticData), so a
      // booking made early grabs the tenant default instead of the real language.
      // Reading conversations.language here fixes the Meta reminder template going
      // out in the wrong language (e.g. Oraz IT customer getting an ES reminder).
      payload.linked_conversation_id
        ? supabase
            .from('conversations')
            .select('language')
            .eq('id', payload.linked_conversation_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // Authoritative booking language: prefer the conversation's tagged language
    // (set from the locked session lang), fall back to the payload, then to the
    // tenant primary, then 'es'. reservations.language is what the reminder cron
    // /n8n reminder workflow reads, so pinning the real chat language here makes
    // the booking_reminder template arrive in the language the customer used.
    const VALID_LANGS = ['es', 'it', 'en', 'de'] as const;
    const _conversationLang = (convLangRes.data as { language?: string } | null)?.language;
    const _tenantPrimaryLang = ((tenantRes.data?.settings as { bot_config?: { primary_language?: string } } | null)?.bot_config?.primary_language || '').slice(0, 2).toLowerCase();
    const effectiveLang: string | undefined = [
      _conversationLang,
      payload.language,
      _tenantPrimaryLang,
    ].map((l) => (l || '').slice(0, 2).toLowerCase()).find((l) => (VALID_LANGS as readonly string[]).includes(l)) || undefined;

    // SaaS gate (Mossa 3): does this tenant run a waitlist? Read once from the
    // settings we already fetched. When off, the three "full → waitlist" fallbacks
    // below decline honestly instead of silently queuing the guest.
    const waitlistEnabled = getFeatures(tenantRes.data?.settings).waitlist_enabled;

    // Party-size rules are PER TENANT — the owner sets the auto-confirm limit in
    // Settings (settings.bot_config). A group at/above party_size_threshold_large
    // needs manual review (escalated); at/above party_size_block_threshold it can't
    // auto-book. Falls back to 7/13 when no policy is set (legacy tenants), matching
    // the previous hardcoded behaviour. The n8n bot delegates the final write here,
    // so this must honour the same threshold the bot used — otherwise a high limit
    // (e.g. 18) gets wrongly rejected by the old hardcoded ceiling.
    const _botCfg = ((tenantRes.data?.settings as { bot_config?: Record<string, unknown> } | null) || {}).bot_config || {};
    const action = getBookingAction(payload.party_size, {
      largeThreshold: Number(_botCfg.party_size_threshold_large) || 7,
      blockThreshold: Number(_botCfg.party_size_block_threshold) || 13,
    });

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
          // Top-level fields so non-Spanish callers (e.g. WhatsApp bot) can localize.
          nextOpen: ohResult.nextOpen ?? null,
          message: `El restaurante está cerrado el ${formatDateFull(payload.date, 'es')}.${nextLabel} ¿Quieres reservar para otro día?`,
        }, { status: 409 });
      }
      if (!ohResult.ok && ohResult.reason === 'outside_hours') {
        return NextResponse.json({
          success: false,
          reason: 'outside_hours',
          // Top-level field so non-Spanish callers can show today's hours in their language.
          hoursToday: ohResult.hoursToday ?? null,
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
    const existingGuests = lookupTail
      ? (existingGuestsRes.data || []).filter((g: { id: string; name: string | null; phone: string | null }) => phoneTail(g.phone) === lookupTail)
      : [];

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
            phone: canonicalPhone || payload.guest_phone,
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
        .select('id, date, time, party_size, status, notes')
        .eq('tenant_id', payload.tenant_id)
        .eq('guest_id', guestId)
        .in('status', ['confirmed', 'seated', 'pending_confirmation', 'escalated'])
        .gte('date', fmt(winStart))
        .lte('date', fmt(winEnd))
        .order('date', { ascending: true });

      // OPTION A — late detail on the SAME reservation, not a new booking.
      // A client often sends booking details across two quick messages
      // ("è un 50° anniversario" then, 12s later, "e una persona è in sedia a
      // rotelle"). The first message already created the reservation, so the
      // second arrives here as a "duplicate" and its detail (the wheelchair)
      // would be lost. If there's exactly one active reservation with the SAME
      // date+time+party_size and the new payload carries notes the existing row
      // doesn't have yet, treat it as an addendum: merge the notes into the
      // existing reservation instead of asking "is this an additional booking?".
      const incomingNotes = cleanGuestNotes(payload.notes);
      if (incomingNotes && nearby && nearby.length === 1) {
        const ex = nearby[0] as any;
        const sameSlot = ex.date === payload.date && (ex.time || '').slice(0, 5) === payload.time.slice(0, 5) && ex.party_size === payload.party_size;
        const exNotes = cleanGuestNotes(ex.notes);
        const exLc = exNotes.toLowerCase();
        const inLc = incomingNotes.toLowerCase();
        // New info only if the two note strings genuinely differ AND neither one
        // already contains the other. The engine usually resends the FULL merged
        // notes ("anniversario + wheelchair"), so the incoming string often
        // contains the existing one — in that case adopt the incoming verbatim
        // instead of concatenating (which would duplicate "anniversario").
        const isNewInfo = sameSlot && exLc !== inLc && !exLc.includes(inLc);
        if (isNewInfo) {
          // If the incoming notes already contain the existing notes, the client
          // (via the bot) sent the cumulative version — use it as-is. Otherwise
          // it's a genuine separate addendum — append it.
          const mergedNotes = !exNotes
            ? incomingNotes
            : inLc.includes(exLc)
              ? incomingNotes
              : `${exNotes} — ${incomingNotes}`;
          const { error: mergeErr } = await supabase
            .from('reservations')
            .update({ notes: mergedNotes })
            .eq('id', ex.id);
          if (!mergeErr) {
            await logAuditEvent({
              tenant_id: payload.tenant_id,
              action: "modify_reservation",
              entity_id: ex.id,
              idempotency_key: payload.idempotency_key,
              source: "ai_agent",
              details: { type: "notes_addendum", added: incomingNotes, notes: mergedNotes },
            });
            return NextResponse.json({
              success: true,
              notes_merged: true,
              reservation_id: ex.id,
              status: ex.status,
              date: ex.date,
              time: ex.time,
              party_size: ex.party_size,
              notes: mergedNotes,
              message: `Detalle añadido a la reserva existente (${ex.date} ${ex.time}). Notas ahora: "${mergedNotes}". Confirma al cliente que has tomado nota de este detalle; NO crees una reserva nueva ni preguntes si es adicional.`,
            });
          }
        }
      }

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

    // Normalize zone preference (accepts inside/outside, fuera/dentro, etc.).
    // The preference is persisted in the `tags` column (zone:inside/outside) for
    // table-less rows (escalated/waitlist), NOT appended to the guest's notes —
    // it used to leak as a Spanish "Prefiere interior" line into the booking.
    const zonePref = normalizeZone(payload.zone || payload.zone_preference);
    // The guest's own note, with any internal Spanish routing annotations the
    // caller (e.g. the n8n voice flow) tacked on already stripped.
    const guestNotes = cleanGuestNotes(payload.notes);
    // waitlist_entries has no `tags` column, so its zone preference still rides
    // in notes (the waitlist page reads it back on conversion). Reservations use
    // the `tags` column instead, keeping the guest's notes clean.
    const zoneNoteLegacy = zonePref ? `Prefiere ${zonePref === 'inside' ? 'interior' : 'exterior'}` : '';

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

    // 5. Handle manual review (large groups, per tenant policy) - check capacity first
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
        if (!waitlistEnabled) {
          return NextResponse.json({
            success: true,
            on_waitlist: false,
            status: 'full',
            has_capacity: false,
            free_seats: freeSeats,
            party_size: payload.party_size,
            shift,
            message: `No hay plazas suficientes para ${payload.party_size} personas en ese turno (plazas libres: ${freeSeats}). No gestionamos lista de espera; ¿quieres probar con otra fecha u hora?`
          });
        }
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
            notes: [guestNotes, zoneNoteLegacy].filter(Boolean).join(' — '),
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

      const reservation: Record<string, any> = {
        tenant_id: payload.tenant_id,
        guest_id: guestId,
        date: payload.date,
        time: payload.time,
        party_size: payload.party_size,
        status: 'escalated',
        source: normalizeBookingSource(payload.source),
        from_web: payload.from_web === true,
        created_by_type: 'ai',
        notes: guestNotes,
        // Escalated rows hold no tables yet, so the zone preference lives in
        // tags (read back on approval from /pending). Keeps notes guest-only.
        tags: zoneTag(zonePref),
        linked_conversation_id: payload.linked_conversation_id,
        end_time: endTime,
        shift,
      };
      // Pin the customer's language so the manual-confirmation WhatsApp (sent
      // when staff approve this escalated request from /pending) goes out in the
      // guest's language instead of defaulting to Spanish. Uses effectiveLang
      // (conversation > payload > tenant primary) — same logic as the
      // normal-booking path below.
      if (effectiveLang) {
        reservation.language = effectiveLang;
      }

      const { data: newRes, error: newResErr } = await supabase
        .from('reservations')
        .insert(reservation)
        .select('id')
        .single();

      if (newResErr) throw newResErr;

      if (payload.linked_conversation_id) {
        await supabase
          .from('conversations')
          .update({ linked_reservation_id: newRes.id })
          .eq('id', payload.linked_conversation_id);
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
          type: "manual_review",
          has_capacity: hasCapacity,
          free_seats: freeSeats,
          free_tables: freeTables.length,
        }
      });

      void sendPushToTenant(payload.tenant_id, 'reservation_escalated', {
        name: payload.guest_name, date: payload.date, time: payload.time, party: payload.party_size,
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

    // 6. Normal booking (within auto-confirm limit) - create reservation then atomically assign tables
    const reservation: Record<string, any> = {
       tenant_id: payload.tenant_id,
       guest_id: guestId,
       date: payload.date,
       time: payload.time,
       party_size: payload.party_size,
       status: payload.status || 'confirmed',
       source: normalizeBookingSource(payload.source),
       from_web: payload.from_web === true,
       created_by_type: 'ai',
       // No zone marker here — the assigned tables already encode the zone, and
       // notes stay guest-only (internal annotations stripped on the way in).
       notes: guestNotes,
       linked_conversation_id: payload.linked_conversation_id,
       end_time: endTime,
       shift,
    };
    // Pin the customer's language to THIS reservation. The reminder cron / n8n
    // reminder workflow read reservations.language to pick the booking_reminder
    // template language, so this must be the language the customer actually used
    // in chat. effectiveLang prefers the conversation's tagged language over the
    // (sometimes stale) payload language — see the resolution block up top.
    if (effectiveLang) {
      reservation.language = effectiveLang;
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

      if (!waitlistEnabled) {
        return NextResponse.json({
          success: true,
          on_waitlist: false,
          status: 'full',
          has_capacity: false,
          free_seats_inside: freeSeatsByZone.inside,
          free_seats_outside: freeSeatsByZone.outside,
          party_size: payload.party_size,
          message: `No hay plazas suficientes para ${payload.party_size} personas en ninguna zona (interior: ${freeSeatsByZone.inside}, exterior: ${freeSeatsByZone.outside}). No gestionamos lista de espera; ¿quieres probar con otra fecha u hora?`
        });
      }

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
          notes: [guestNotes, zoneNoteLegacy].filter(Boolean).join(' — '),
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

      void sendPushToTenant(payload.tenant_id, 'waitlist_new', {
        name: payload.guest_name, date: payload.date, time: payload.time, party: payload.party_size,
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

      if (!waitlistEnabled) {
        return NextResponse.json({
          success: true,
          on_waitlist: false,
          status: 'full',
          has_capacity: false,
          free_seats: atomicResult.free_seats,
          party_size: payload.party_size,
          message: `No hay plazas suficientes en el turno. No gestionamos lista de espera; ¿quieres probar con otra fecha u hora?`
        });
      }

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
          notes: [guestNotes, zoneNoteLegacy].filter(Boolean).join(' — '),
        })
        .select('id')
        .single();

      if (waitErr) throw waitErr;

      await logAuditEvent({
        tenant_id: payload.tenant_id, action: "create_waitlist",
        entity_id: newWait.id, idempotency_key: payload.idempotency_key,
        source: "ai_agent", details: { type: "no_capacity_race", free_seats: atomicResult.free_seats, party_size: payload.party_size }
      });

      void sendPushToTenant(payload.tenant_id, 'waitlist_new', {
        name: payload.guest_name, date: payload.date, time: payload.time, party: payload.party_size,
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

    if (payload.linked_conversation_id) {
      await supabase
        .from('conversations')
        .update({ linked_reservation_id: newRes.id })
        .eq('id', payload.linked_conversation_id);
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

    // Recovery: una booking è andata in porto → chiudi gli open di booking_error per il tenant
    void resolveSystemEvents({
      error_key: `booking:${payload.tenant_id}`,
      tenant_id: payload.tenant_id,
    });

    void sendPushToTenant(payload.tenant_id, 'reservation_new', {
      name: payload.guest_name, date: payload.date, time: payload.time, party: payload.party_size,
    });

    // Venue recap for the confirmation message (WhatsApp/voice): address +
    // clickable Google Maps link, parking, deposit (large groups) and the
    // cancellation notice — in the guest's booking language. Sourced from the
    // structured settings.venue (set at onboarding), NOT re-parsed from the KB.
    // n8n appends the non-empty lines to the recap card. Absent for legacy
    // tenants with no settings.venue → fields are simply omitted.
    const venue = ((tenantRes.data?.settings as { venue?: VenueInfo } | null) || {}).venue;
    const venueLines = venue
      ? bookingVenueLines(venue, (effectiveLang || 'es') as Lang)
      : null;

    return NextResponse.json({
       success: true,
       reservation_id: newRes.id,
       status: 'confirmed',
       shift,
       end_time: endTime,
       tables_assigned: atomicResult.tables_assigned,
       zone_assigned: assignedZone,
       message: "Reservation successfully created.",
       // Extra fields for the booking confirmation recap (empty string = omit).
       restaurant_address: venueLines?.address || "",
       maps_url: venueLines?.mapsUrl || "",
       parking: venueLines?.parking || "",
       // Deposit only matters for large groups (manual confirmation path); the
       // recap shows it only when both a deposit is required AND it's a big party.
       deposit_note: venueLines?.deposit || "",
       cancellation_note: venueLines?.cancellation || "",
    });

  } catch (error: any) {
    console.error("Booking Error:", error);
    logSystemEvent({
      category: "booking_error",
      severity: "critical",
      title: "Booking creation failed",
      description: error.message,
      error_key: `booking:service`,
    });
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
