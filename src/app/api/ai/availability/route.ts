import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getShift,
  getTimeSlots,
  isOpen,
  type OpeningHours,
} from '@/lib/restaurant-rules';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant_id = searchParams.get('tenant_id');
    const date = searchParams.get('date');
    const party_size = searchParams.get('party_size');
    const zoneParam = (searchParams.get('zone') || '').toLowerCase();

    if (!tenant_id || !date || !party_size) {
      return NextResponse.json({ success: false, error: "Missing required params" }, { status: 400 });
    }

    let zone: 'inside' | 'outside' | null = null;
    if (zoneParam.includes('inside') || zoneParam.includes('interior') || zoneParam.includes('dentro') || zoneParam.includes('interno')) zone = 'inside';
    else if (zoneParam.includes('outside') || zoneParam.includes('exterior') || zoneParam.includes('fuera') || zoneParam.includes('terraza') || zoneParam.includes('outdoor')) zone = 'outside';

    const pax = parseInt(party_size);
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    const supabase = createServiceRoleClient();

    // Fetch tenant opening_hours — single source of truth
    const { data: tenantRow, error: tenantErr } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenant_id)
      .maybeSingle();

    if (tenantErr) throw tenantErr;

    const openingHours: OpeningHours = (tenantRow?.settings as any)?.opening_hours || {};
    const slots = getTimeSlots(dayOfWeek, openingHours);

    if (slots.length === 0) {
      return NextResponse.json({
        success: true,
        date,
        party_size: pax,
        availability: [],
        message: "Restaurant is closed on this day"
      });
    }

    // Fetch active tables (seats matter — variable seat counts)
    let tablesQuery = supabase
      .from('restaurant_tables')
      .select('id, seats, zone')
      .eq('tenant_id', tenant_id)
      .eq('status', 'active');
    if (zone) tablesQuery = tablesQuery.eq('zone', zone);
    const { data: tables, error: tablesErr } = await tablesQuery;

    if (tablesErr) throw tablesErr;

    const allTables = (tables || []) as { id: string; seats: number; zone: string }[];

    // Fetch reservations for the date with their assigned tables
    const { data: reservations, error: resErr } = await supabase
      .from('reservations')
      .select('id, time, party_size, end_time, shift')
      .eq('tenant_id', tenant_id)
      .eq('date', date)
      .in('status', ['confirmed', 'seated', 'pending_confirmation', 'escalated']);

    if (resErr) throw resErr;

    // Fetch reservation_tables for those reservations
    const resIds = (reservations || []).map((r: any) => r.id);
    let reservationTableMap: Record<string, string[]> = {};

    if (resIds.length > 0) {
      const { data: resTables, error: rtErr } = await supabase
        .from('reservation_tables')
        .select('reservation_id, table_id')
        .in('reservation_id', resIds);

      if (rtErr) throw rtErr;

      for (const rt of (resTables || [])) {
        if (!reservationTableMap[rt.reservation_id]) {
          reservationTableMap[rt.reservation_id] = [];
        }
        reservationTableMap[rt.reservation_id].push(rt.table_id);
      }
    }

    // For each slot, mirror atomic_book_tables: a slot is available if
    //   1) any single free table has seats >= party_size, OR
    //   2) the sum of free table seats (largest first) >= party_size
    // Tables are occupied for the ENTIRE shift.
    const availability = slots.map(time => {
      const slotShift = getShift(time);
      if (!isOpen(dayOfWeek, slotShift, openingHours)) {
        return { time, available: false, free_tables: 0 };
      }

      const occupiedTableIds = new Set<string>();
      for (const res of (reservations || [])) {
        const resShift = res.shift || getShift(res.time);
        if (resShift === slotShift) {
          const assignedTables = reservationTableMap[res.id] || [];
          for (const tid of assignedTables) occupiedTableIds.add(tid);
        }
      }

      const freeTables = allTables.filter((t) => !occupiedTableIds.has(t.id));
      const hasSingleFit = freeTables.some((t) => t.seats >= pax);
      const totalFreeSeats = freeTables.reduce((s, t) => s + t.seats, 0);
      const fits = hasSingleFit || totalFreeSeats >= pax;

      return {
        time,
        available: fits,
        free_tables: freeTables.length,
      };
    });

    return NextResponse.json({
      success: true,
      date,
      party_size: pax,
      availability
    });

  } catch (error: any) {
    console.error("Availability Check Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
