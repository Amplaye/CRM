import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/audit';
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
}

export async function PUT(request: Request) {
  try {
    const payload: ModifyPayload = await request.json();

    if (!payload.tenant_id || (!payload.reservation_id && !payload.guest_phone)) {
      return NextResponse.json({ success: false, error: "Missing tenant_id and reservation_id or guest_phone" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

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

      // Try each matching guest until we find one with an active reservation
      for (const guest of matchingGuests) {
        const { data: resList } = await supabase
          .from('reservations')
          .select('id')
          .eq('tenant_id', payload.tenant_id)
          .eq('guest_id', guest.id)
          .in('status', ['confirmed', 'pending_confirmation', 'escalated', 'seated', 'completed'])
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

    // Build updates
    const newDate = payload.date || existing.date;
    const newTime = payload.time || existing.time;
    const newPartySize = payload.party_size || existing.party_size;
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

    if (payload.notes !== undefined) {
      if (payload.notes && existing.notes && !payload.notes.includes(existing.notes)) {
        // Append new notes to existing (voice agent can't see previous notes)
        updates.notes = `${existing.notes}, ${payload.notes}`;
      } else {
        updates.notes = payload.notes;
      }
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
      // Remove old table assignments and let atomic_book_tables decide
      // the new optimal assignment based on the (possibly variable) seat
      // counts of the available tables.
      await supabase.from('reservation_tables').delete().eq('reservation_id', reservationId);

      const { data: atomicResult, error: atomicErr } = await supabase.rpc('atomic_book_tables', {
        p_tenant_id: payload.tenant_id,
        p_date: newDate,
        p_shift: newShift,
        p_tables_needed: tablesNeeded(newPartySize),
        p_reservation_id: reservationId,
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
      message: becameLargeGroup
        ? `Reserva modificada a ${newPartySize} personas — pendiente de revisión por ser grupo grande.`
        : "Reserva modificada correctamente."
    });

  } catch (error: any) {
    console.error("Modify Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
