import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getShift,
  getRotationMinutes,
  calculateEndTime,
  tablesNeeded,
  getTimeSlots,
  isOpen,
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant_id = searchParams.get('tenant_id');
    const date = searchParams.get('date');
    const party_size = searchParams.get('party_size');

    if (!tenant_id || !date || !party_size) {
      return NextResponse.json({ success: false, error: "Missing required params" }, { status: 400 });
    }

    const pax = parseInt(party_size);
    const needed = tablesNeeded(pax);
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const slots = getTimeSlots(dayOfWeek);

    if (slots.length === 0) {
      return NextResponse.json({
        success: true,
        date,
        party_size: pax,
        availability: [],
        message: "Restaurant is closed on this day"
      });
    }

    const supabase = createServiceRoleClient();

    // Fetch active tables
    const { data: tables, error: tablesErr } = await supabase
      .from('restaurant_tables')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('status', 'active');

    if (tablesErr) throw tablesErr;

    const totalActiveTables = (tables || []).length;
    const tableIds = (tables || []).map((t: any) => t.id);

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

    // For each slot, count free tables
    // Tables are occupied for the ENTIRE shift (customers can stay as long as they want)
    const availability = slots.map(time => {
      const slotShift = getShift(time);
      if (!isOpen(dayOfWeek, slotShift)) {
        return { time, available: false, free_tables: 0 };
      }

      // Find which tables are occupied in the same shift
      const occupiedTableIds = new Set<string>();

      for (const res of (reservations || [])) {
        const resShift = res.shift || getShift(res.time);
        if (resShift === slotShift) {
          const assignedTables = reservationTableMap[res.id] || [];
          for (const tid of assignedTables) {
            occupiedTableIds.add(tid);
          }
        }
      }

      const freeTables = totalActiveTables - occupiedTableIds.size;

      return {
        time,
        available: freeTables >= needed,
        free_tables: freeTables,
      };
    });

    return NextResponse.json({
      success: true,
      date,
      party_size: pax,
      tables_needed: needed,
      availability
    });

  } catch (error: any) {
    console.error("Availability Check Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
