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
      updates.notes = payload.notes;
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
      // Remove old table assignments
      await supabase.from('reservation_tables').delete().eq('reservation_id', reservationId);

      // Find free tables for the new date+shift
      const needed = tablesNeeded(newPartySize);

      const { data: activeTables } = await supabase
        .from('restaurant_tables')
        .select('id, name')
        .eq('tenant_id', payload.tenant_id)
        .eq('status', 'active');

      const { data: otherRes } = await supabase
        .from('reservations')
        .select('id, time, shift')
        .eq('tenant_id', payload.tenant_id)
        .eq('date', newDate)
        .in('status', ['confirmed', 'seated', 'pending_confirmation', 'escalated'])
        .neq('id', reservationId);

      const otherIds = (otherRes || []).filter((r: any) => {
        const rShift = r.shift || getShift(r.time);
        return rShift === newShift;
      }).map((r: any) => r.id);

      const occupiedTableIds = new Set<string>();
      if (otherIds.length > 0) {
        const { data: otherLinks } = await supabase
          .from('reservation_tables')
          .select('table_id')
          .in('reservation_id', otherIds);
        for (const link of (otherLinks || [])) {
          occupiedTableIds.add(link.table_id);
        }
      }

      const freeTables = (activeTables || []).filter((t: any) => !occupiedTableIds.has(t.id));

      if (freeTables.length >= needed) {
        const assigned = freeTables.slice(0, needed);
        await supabase.from('reservation_tables').insert(
          assigned.map((t: any) => ({ reservation_id: reservationId, table_id: t.id }))
        );
        tablesAssigned = assigned.map((t: any) => t.name);
      } else {
        // Not enough tables — escalate
        await supabase.from('reservations').update({ status: 'escalated', notes: `${updates.notes || existing.notes || ''}\nNo hay mesas disponibles tras modificación`.trim() }).eq('id', reservationId);

        await logAuditEvent({
          tenant_id: payload.tenant_id,
          action: "modify_reservation",
          entity_id: reservationId,
          source: "ai_agent",
          details: { previous: { date: existing.date, time: existing.time, party_size: existing.party_size }, updates, escalated: true }
        });

        return NextResponse.json({
          success: true,
          reservation_id: reservationId,
          status: 'escalated',
          shift: newShift,
          end_time: newEndTime,
          tables_assigned: [],
          message: `Reserva modificada pero no hay mesas suficientes (necesarias: ${needed}, libres: ${freeTables.length}). Pendiente de revisión.`
        });
      }
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
      status: existing.status,
      shift: newShift,
      end_time: newEndTime,
      tables_assigned: tablesAssigned,
      message: "Reserva modificada correctamente."
    });

  } catch (error: any) {
    console.error("Modify Booking Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
