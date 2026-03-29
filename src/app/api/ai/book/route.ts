import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CreateBookingRequest } from '@/lib/types';
import { logAuditEvent } from '@/lib/audit';
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
       if (payload.guest_name && payload.guest_name !== "Unknown Guest" && existingGuests[0].name === "Unknown Guest") {
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
      .select('id, name')
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

    // Find occupied table IDs during the requested window
    const occupiedTableIds = new Set<string>();
    for (const res of (existingRes || [])) {
      const resEnd = res.end_time || calculateEndTime(res.time, getRotationMinutes(
        res.party_size,
        res.shift || getShift(res.time),
        dayOfWeek
      ));

      if (rangesOverlap(payload.time, endTime, res.time, resEnd)) {
        const assigned = reservationTableMap[res.id] || [];
        for (const tid of assigned) {
          occupiedTableIds.add(tid);
        }
      }
    }

    // 5. Handle manual review (7-12 people) - NO table assignment
    if (action === 'manual_review' || action === 'reject') {
      const reservation = {
        tenant_id: payload.tenant_id,
        guest_id: guestId,
        date: payload.date,
        time: payload.time,
        party_size: payload.party_size,
        status: 'escalated',
        source: payload.source || 'ai_voice',
        created_by_type: 'ai',
        notes: payload.notes || "Grupo grande - pendiente de revisión",
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
        }
      });

      return NextResponse.json({
        success: true,
        reservation_id: newRes.id,
        status: 'escalated',
        shift,
        end_time: endTime,
        tables_assigned: [],
        message: "Solicitud registrada. Pendiente de revisión del responsable."
      });
    }

    // 6. Normal booking (1-6 people) - assign tables
    const freeTables = (activeTables || []).filter((t: any) => !occupiedTableIds.has(t.id));

    if (freeTables.length < needed) {
      return NextResponse.json({
        success: false,
        error: `Not enough tables available. Need ${needed}, only ${freeTables.length} free.`
      }, { status: 409 });
    }

    const assignedTables = freeTables.slice(0, needed);

    const reservation = {
       tenant_id: payload.tenant_id,
       guest_id: guestId,
       date: payload.date,
       time: payload.time,
       party_size: payload.party_size,
       status: 'confirmed',
       source: payload.source || 'ai_voice',
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

    const tableInserts = assignedTables.map((t: any) => ({
      reservation_id: newRes.id,
      table_id: t.id,
    }));

    await supabase.from('reservation_tables').insert(tableInserts);

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
          tables_assigned: assignedTables.map((t: any) => t.name),
       }
    });

    return NextResponse.json({
       success: true,
       reservation_id: newRes.id,
       status: 'confirmed',
       shift,
       end_time: endTime,
       tables_assigned: assignedTables.map((t: any) => t.name),
       message: "Reservation successfully created."
    });

  } catch (error: any) {
    console.error("Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
