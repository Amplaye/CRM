import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { assertRateLimit } from '@/lib/rate-limit';
import {
  getShift,
  getTimeSlots,
  isOpen,
  type OpeningHours,
} from '@/lib/restaurant-rules';

const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function findNextOpenDay(openingHours: OpeningHours, fromDate: string, maxLookahead = 7) {
  const base = new Date(fromDate + 'T12:00:00');
  for (let i = 1; i <= maxLookahead; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const dow = d.getDay();
    const slots = openingHours[String(dow)] || [];
    if (slots.length > 0) {
      const iso = d.toISOString().slice(0, 10);
      return { date: iso, weekday: WEEKDAYS_ES[dow], hours: slots };
    }
  }
  return null;
}

function lastBookingTime(shiftHours: { open: string; close: string }[], shift: 'lunch' | 'dinner'): string | null {
  // Last reservation cutoff before close: lunch 45 min, dinner 60 min.
  // Matches Picnic's KB policy (última reserva 14:45 / 21:30).
  const offset = shift === 'dinner' ? 60 : 45;
  for (const s of shiftHours) {
    const startMin = timeToMin(s.open);
    if ((shift === 'lunch' && startMin < 17 * 60) || (shift === 'dinner' && startMin >= 17 * 60)) {
      return minToTime(Math.max(startMin, timeToMin(s.close) - offset));
    }
  }
  return null;
}

export async function GET(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;
  const rl = await assertRateLimit(request, 'ai:availability', { max: 240, windowSecs: 60 });
  if (rl) return rl;
  try {
    const { searchParams } = new URL(request.url);
    const tenant_id = searchParams.get('tenant_id');
    const date = searchParams.get('date');
    const party_size = searchParams.get('party_size');
    const zoneParam = (searchParams.get('zone') || '').toLowerCase();
    const timeParam = searchParams.get('time'); // optional — enables structured pre-check

    if (!tenant_id || !date || !party_size) {
      return NextResponse.json({ success: false, error: 'Missing required params' }, { status: 400 });
    }

    let zone: 'inside' | 'outside' | null = null;
    if (zoneParam.includes('inside') || zoneParam.includes('interior') || zoneParam.includes('dentro') || zoneParam.includes('interno')) zone = 'inside';
    else if (zoneParam.includes('outside') || zoneParam.includes('exterior') || zoneParam.includes('fuera') || zoneParam.includes('terraza') || zoneParam.includes('outdoor')) zone = 'outside';

    const pax = parseInt(party_size);
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const weekday = WEEKDAYS_ES[dayOfWeek];

    const supabase = createServiceRoleClient();

    // Fetch tenant opening_hours
    const { data: tenantRow, error: tenantErr } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenant_id)
      .maybeSingle();
    if (tenantErr) throw tenantErr;

    const openingHours: OpeningHours = ((tenantRow?.settings as unknown) as { opening_hours?: OpeningHours })?.opening_hours || {};
    const hoursToday = openingHours[String(dayOfWeek)] || [];
    const slots = getTimeSlots(dayOfWeek, openingHours);

    const lastLunch = lastBookingTime(hoursToday, 'lunch');
    const lastDinner = lastBookingTime(hoursToday, 'dinner');
    const lastReservationTimes = {
      ...(lastLunch ? { lunch: lastLunch } : {}),
      ...(lastDinner ? { dinner: lastDinner } : {}),
    };

    // --- Case A: restaurant is closed all day ---
    if (hoursToday.length === 0) {
      const nextOpen = findNextOpenDay(openingHours, date);
      const nextLabel = nextOpen ? `el ${nextOpen.weekday}` : '';
      return NextResponse.json({
        success: true,
        date,
        weekday,
        party_size: pax,
        zone,
        hours_today: [],
        status: 'closed_day',
        next_open: nextOpen,
        message: `Ese día estamos cerrados. Abrimos ${nextLabel}. ¿Quieres reservar para otro día?`,
        availability: [],
      });
    }

    // Fetch active tables
    let tablesQuery = supabase
      .from('restaurant_tables')
      .select('id, seats, zone')
      .eq('tenant_id', tenant_id)
      .eq('status', 'active');
    if (zone) tablesQuery = tablesQuery.eq('zone', zone);
    const { data: tables, error: tablesErr } = await tablesQuery;
    if (tablesErr) throw tablesErr;
    const allTables = (tables || []) as { id: string; seats: number; zone: string }[];

    // Fetch reservations for the date
    const { data: reservations, error: resErr } = await supabase
      .from('reservations')
      .select('id, time, party_size, end_time, shift')
      .eq('tenant_id', tenant_id)
      .eq('date', date)
      .in('status', ['confirmed', 'seated', 'pending_confirmation', 'escalated']);
    if (resErr) throw resErr;

    // Build occupancy map per reservation
    const resIds = (reservations || []).map((r: any) => r.id);
    const reservationTableMap: Record<string, string[]> = {};
    if (resIds.length > 0) {
      const { data: resTables } = await supabase
        .from('reservation_tables')
        .select('reservation_id, table_id')
        .in('reservation_id', resIds);
      for (const rt of resTables || []) {
        if (!reservationTableMap[rt.reservation_id]) reservationTableMap[rt.reservation_id] = [];
        reservationTableMap[rt.reservation_id].push(rt.table_id);
      }
    }

    // Per-slot availability (mirror atomic_book_tables logic)
    const availability = slots.map((time) => {
      const slotShift = getShift(time);
      if (!isOpen(dayOfWeek, slotShift, openingHours)) {
        return { time, available: false, free_tables: 0 };
      }
      const occupied = new Set<string>();
      for (const res of reservations || []) {
        const rs = res.shift || getShift(res.time);
        if (rs === slotShift) {
          for (const tid of reservationTableMap[res.id] || []) occupied.add(tid);
        }
      }
      const freeTables = allTables.filter((t) => !occupied.has(t.id));
      const hasSingleFit = freeTables.some((t) => t.seats >= pax);
      const totalFreeSeats = freeTables.reduce((s, t) => s + t.seats, 0);
      const fits = hasSingleFit || totalFreeSeats >= pax;
      return { time, available: fits, free_tables: freeTables.length };
    });

    // --- Case B: no specific time — return legacy array + context fields ---
    if (!timeParam) {
      return NextResponse.json({
        success: true,
        date,
        weekday,
        party_size: pax,
        zone,
        hours_today: hoursToday,
        last_reservation_times: lastReservationTimes,
        availability,
      });
    }

    // --- Case C: specific time requested — structured pre-check ---
    const reqShift = getShift(timeParam);
    const dayIsOpenForShift = isOpen(dayOfWeek, reqShift, openingHours);

    // Outside hours? (shift closed OR requested time before/after the open window)
    const reqMin = timeToMin(timeParam);
    const shiftWindow = hoursToday.find((h) => {
      const s = timeToMin(h.open);
      const e = timeToMin(h.close);
      if (reqShift === 'lunch' && s < 17 * 60) return true;
      if (reqShift === 'dinner' && s >= 17 * 60) return true;
      return false;
    });

    if (!dayIsOpenForShift || !shiftWindow) {
      const hoursList = hoursToday.map((h) => `${h.open}-${h.close}`).join(' y ');
      return NextResponse.json({
        success: true,
        date,
        weekday,
        party_size: pax,
        zone,
        hours_today: hoursToday,
        last_reservation_times: lastReservationTimes,
        requested_time: timeParam,
        status: 'outside_hours',
        reason_detail: `El turno de ${reqShift === 'lunch' ? 'almuerzo' : 'cena'} no está abierto ese día.`,
        message: `El turno de ${reqShift === 'lunch' ? 'almuerzo' : 'cena'} no está abierto ese día. Ese día abrimos ${hoursList}. ¿Quieres cambiar la hora?`,
        availability,
      });
    }

    // After last reservation time?
    const lastForShift = reqShift === 'lunch' ? lastLunch : lastDinner;
    if (lastForShift && reqMin > timeToMin(lastForShift)) {
      return NextResponse.json({
        success: true,
        date,
        weekday,
        party_size: pax,
        zone,
        hours_today: hoursToday,
        last_reservation_times: lastReservationTimes,
        requested_time: timeParam,
        status: 'after_last_reservation',
        reason_detail: `La última reserva de ${reqShift === 'lunch' ? 'almuerzo' : 'cena'} es a las ${lastForShift}.`,
        message: `La última reserva de ${reqShift === 'lunch' ? 'almuerzo' : 'cena'} es a las ${lastForShift}. ¿Te viene bien a esa hora o antes?`,
        availability,
      });
    }

    // Before the shift opens?
    if (reqMin < timeToMin(shiftWindow.open)) {
      return NextResponse.json({
        success: true,
        date,
        weekday,
        party_size: pax,
        zone,
        hours_today: hoursToday,
        last_reservation_times: lastReservationTimes,
        requested_time: timeParam,
        status: 'outside_hours',
        reason_detail: `Abrimos a las ${shiftWindow.open} para ${reqShift === 'lunch' ? 'almuerzo' : 'cena'}.`,
        message: `Abrimos a las ${shiftWindow.open} para ${reqShift === 'lunch' ? 'el almuerzo' : 'la cena'}. ¿Quieres reservar para esa hora o un poco más tarde?`,
        availability,
      });
    }

    // Find the matching slot row
    const matchingSlot = availability.find((a) => a.time === timeParam);
    if (matchingSlot && matchingSlot.available) {
      return NextResponse.json({
        success: true,
        date,
        weekday,
        party_size: pax,
        zone,
        hours_today: hoursToday,
        last_reservation_times: lastReservationTimes,
        requested_time: timeParam,
        status: 'available',
        free_tables: matchingSlot.free_tables,
        message: `Sí, tenemos mesa para ${pax} personas a las ${timeParam}.`,
        availability,
      });
    }

    // No tables at requested time — build 3 nearest alternative times within the same shift
    const alternatives = availability
      .filter((a) => a.available && getShift(a.time) === reqShift)
      .map((a) => ({ time: a.time, distance: Math.abs(timeToMin(a.time) - reqMin) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map((a) => a.time);

    const altsPhrase = alternatives.length > 0
      ? `Tengo disponibilidad a las ${alternatives.join(', ')}. ¿Te va bien alguna?`
      : 'No tengo otras horas cercanas con disponibilidad ese día.';
    return NextResponse.json({
      success: true,
      date,
      weekday,
      party_size: pax,
      zone,
      hours_today: hoursToday,
      last_reservation_times: lastReservationTimes,
      requested_time: timeParam,
      status: 'no_tables',
      alternatives,
      message: `Para las ${timeParam} no tengo mesa para ${pax} personas. ${altsPhrase}`,
      availability,
    });
  } catch (error: any) {
    console.error('Availability Check Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
