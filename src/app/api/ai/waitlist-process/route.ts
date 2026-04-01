// @ts-nocheck
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  getShift,
  getRotationMinutes,
  calculateEndTime,
  tablesNeeded,
} from '@/lib/restaurant-rules';

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * POST /api/ai/waitlist-process
 *
 * Called when a table frees up (cancellation, no-show, rejection).
 * Finds the best waitlist candidate and auto-assigns them.
 * Also supports gap-based booking: if all tables are occupied for the full shift,
 * checks if there's a 2-hour gap before an existing reservation to offer a time-limited slot.
 *
 * Body: { tenant_id, date, shift?, freed_table_ids?: string[] }
 */
export async function POST(request: Request) {
  try {
    const { tenant_id, date, shift: requestedShift, freed_table_ids } = await request.json();

    if (!tenant_id || !date) {
      return NextResponse.json({ success: false, error: "Missing tenant_id or date" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Determine which shifts to check
    const shiftsToCheck: Array<'lunch' | 'dinner'> = requestedShift
      ? [requestedShift]
      : ['lunch', 'dinner'];

    let totalMatched = 0;
    const results: any[] = [];
    const debugInfo: any = { shiftsChecked: shiftsToCheck, shifts: {} };

    for (const shift of shiftsToCheck) {
      const shiftDebug: any = {};
      // Get all active tables
      const { data: allTables } = await supabase
        .from('restaurant_tables')
        .select('id, name, seats')
        .eq('tenant_id', tenant_id)
        .eq('status', 'active');

      if (!allTables || allTables.length === 0) continue;

      // Get active reservations for this date + shift
      const { data: reservations } = await supabase
        .from('reservations')
        .select('id, time, end_time, party_size, shift, guest_id')
        .eq('tenant_id', tenant_id)
        .eq('date', date)
        .in('status', ['confirmed', 'seated', 'pending_confirmation']);

      const shiftReservations = (reservations || []).filter((r: any) => {
        const rShift = r.shift || getShift(r.time);
        return rShift === shift;
      });

      // Get table assignments for these reservations
      const resIds = shiftReservations.map(r => r.id);
      let tableAssignments: Record<string, string[]> = {};
      let tableToReservation: Record<string, any[]> = {};

      if (resIds.length > 0) {
        const { data: links } = await supabase
          .from('reservation_tables')
          .select('reservation_id, table_id')
          .in('reservation_id', resIds);

        for (const link of (links || [])) {
          if (!tableAssignments[link.reservation_id]) tableAssignments[link.reservation_id] = [];
          tableAssignments[link.reservation_id].push(link.table_id);

          if (!tableToReservation[link.table_id]) tableToReservation[link.table_id] = [];
          const res = shiftReservations.find(r => r.id === link.reservation_id);
          if (res) tableToReservation[link.table_id].push(res);
        }
      }

      // Find free tables (no reservation this shift)
      const occupiedTableIds = new Set<string>();
      for (const res of shiftReservations) {
        const assigned = tableAssignments[res.id] || [];
        for (const tid of assigned) occupiedTableIds.add(tid);
      }

      const freeTables = allTables.filter(t => !occupiedTableIds.has(t.id));
      shiftDebug.totalTables = allTables.length;
      shiftDebug.shiftReservations = shiftReservations.length;
      shiftDebug.occupiedTables = occupiedTableIds.size;
      shiftDebug.freeTables = freeTables.length;

      // Get waiting waitlist entries for this date
      const { data: waitingEntries } = await supabase
        .from('waitlist_entries')
        .select('*, guests(name, phone)')
        .eq('tenant_id', tenant_id)
        .eq('date', date)
        .eq('status', 'waiting')
        .order('priority_score', { ascending: false });

      shiftDebug.waitingEntries = (waitingEntries || []).length;
      debugInfo.shifts[shift] = shiftDebug;
      if (!waitingEntries || waitingEntries.length === 0) continue;

      for (const entry of waitingEntries) {
        const entryShift = getShift(entry.target_time);
        if (entryShift !== shift) continue;

        // Re-check status (might have been updated in a previous iteration)
        const { data: freshEntry } = await supabase
          .from('waitlist_entries')
          .select('status')
          .eq('id', entry.id)
          .single();
        if (!freshEntry || freshEntry.status !== 'waiting') continue;

        const needed = tablesNeeded(entry.party_size);
        const guestPhone = entry.guests?.phone || '';
        const guestName = entry.guests?.name || 'Cliente';

        // OPTION 1: Free tables available (full shift)
        if (freeTables.length >= needed) {
          const assignedTables = freeTables.splice(0, needed);
          const dayOfWeek = new Date(date + 'T12:00:00').getDay();
          const rotation = getRotationMinutes(entry.party_size, entryShift, dayOfWeek);
          const endTime = calculateEndTime(entry.target_time, rotation);

          // Create reservation
          const { data: newRes, error: resErr } = await supabase
            .from('reservations')
            .insert({
              tenant_id,
              guest_id: entry.guest_id,
              date,
              time: entry.target_time,
              end_time: endTime,
              shift: entryShift,
              party_size: entry.party_size,
              status: 'confirmed',
              source: 'waitlist',
              created_by_type: 'system',
              notes: `Auto-asignado desde lista de espera (prioridad: ${entry.priority_score})`,
            })
            .select('id')
            .single();

          if (resErr || !newRes) {
            debugInfo.resInsertError = resErr?.message || 'newRes is null';
            continue;
          }

          // Assign tables
          await supabase.from('reservation_tables').insert(
            assignedTables.map(t => ({ reservation_id: newRes.id, table_id: t.id }))
          );

          // Update waitlist entry
          await supabase.from('waitlist_entries').update({
            status: 'converted_to_booking',
            matched_reservation_id: newRes.id,
            updated_at: new Date().toISOString(),
          }).eq('id', entry.id);

          // Remove these tables from freeTables for next iteration
          for (const t of assignedTables) {
            occupiedTableIds.add(t.id);
          }

          // Notify client via WhatsApp
          if (guestPhone) {
            await notifyClient(guestPhone, guestName, date, entry.target_time, endTime, entry.party_size, assignedTables.map(t => t.name), null);
          }

          // Notify owner
          await notifyOwner(guestName, date, entry.target_time, entry.party_size, assignedTables.map(t => t.name), guestPhone, false);

          totalMatched++;
          results.push({ type: 'full_shift', entryId: entry.id, reservationId: newRes.id });
          continue;
        }

        // OPTION 2: No free tables — check for 2-hour gaps
        if (needed <= allTables.length) {
          const gapTables = findGapTables(allTables, tableToReservation, entry.target_time, needed);

          if (gapTables.length >= needed) {
            const selectedGapTables = gapTables.slice(0, needed);
            const earliestNextRes = selectedGapTables.reduce((min, gt) => {
              return gt.gapEndMinutes < min ? gt.gapEndMinutes : min;
            }, Infinity);

            // End time = 15 min before next reservation (buffer for cleaning)
            const limitedEndMinutes = earliestNextRes - 15;
            const gapDuration = limitedEndMinutes - timeToMinutes(entry.target_time);

            if (gapDuration >= 120) { // At least 2 hours
              const limitedEndTime = `${String(Math.floor(limitedEndMinutes / 60)).padStart(2, '0')}:${String(limitedEndMinutes % 60).padStart(2, '0')}`;

              // Create time-limited reservation
              const { data: newRes, error: resErr } = await supabase
                .from('reservations')
                .insert({
                  tenant_id,
                  guest_id: entry.guest_id,
                  date,
                  time: entry.target_time,
                  end_time: limitedEndTime,
                  shift: entryShift,
                  party_size: entry.party_size,
                  status: 'confirmed',
                  source: 'waitlist',
                  created_by_type: 'system',
                  notes: `Auto-asignado desde lista de espera con tiempo limitado (hasta ${limitedEndTime}). Prioridad: ${entry.priority_score}`,
                })
                .select('id')
                .single();

              if (resErr || !newRes) continue;

              const tableIds = selectedGapTables.map(gt => gt.tableId);
              await supabase.from('reservation_tables').insert(
                tableIds.map(tid => ({ reservation_id: newRes.id, table_id: tid }))
              );

              await supabase.from('waitlist_entries').update({
                status: 'converted_to_booking',
                matched_reservation_id: newRes.id,
                updated_at: new Date().toISOString(),
              }).eq('id', entry.id);

              const tableNames = selectedGapTables.map(gt => gt.tableName);

              // Notify client with time limit
              if (guestPhone) {
                await notifyClient(guestPhone, guestName, date, entry.target_time, limitedEndTime, entry.party_size, tableNames, limitedEndTime);
              }

              await notifyOwner(guestName, date, entry.target_time, entry.party_size, tableNames, guestPhone, true, limitedEndTime);

              totalMatched++;
              results.push({ type: 'gap_based', entryId: entry.id, reservationId: newRes.id, endTime: limitedEndTime });
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      matched: totalMatched,
      results,
      debug: debugInfo,
    });

  } catch (error: any) {
    console.error("Waitlist Process Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * Find tables that have a gap of 2+ hours before their next reservation.
 */
function findGapTables(
  allTables: any[],
  tableToReservation: Record<string, any[]>,
  requestedTime: string,
  needed: number
): Array<{ tableId: string; tableName: string; gapEndMinutes: number }> {
  const requestedMinutes = timeToMinutes(requestedTime);
  const gapTables: Array<{ tableId: string; tableName: string; gapEndMinutes: number }> = [];

  for (const table of allTables) {
    const reservations = tableToReservation[table.id] || [];

    if (reservations.length === 0) {
      // Table is free for the whole shift — shouldn't happen here but handle it
      gapTables.push({ tableId: table.id, tableName: table.name, gapEndMinutes: 24 * 60 });
      continue;
    }

    // Find the earliest reservation on this table that starts AFTER the requested time
    let earliestAfterRequest = Infinity;
    for (const res of reservations) {
      const resStart = timeToMinutes(res.time);
      if (resStart > requestedMinutes) {
        earliestAfterRequest = Math.min(earliestAfterRequest, resStart);
      }
    }

    // Check if there's also a reservation that overlaps with requested time
    const hasOverlap = reservations.some(res => {
      const resStart = timeToMinutes(res.time);
      const resEnd = res.end_time ? timeToMinutes(res.end_time) : resStart + 120;
      return requestedMinutes >= resStart && requestedMinutes < resEnd;
    });

    if (!hasOverlap && earliestAfterRequest !== Infinity) {
      const gapMinutes = earliestAfterRequest - requestedMinutes;
      if (gapMinutes >= 135) { // At least 2h15m (2h for customer + 15min buffer)
        gapTables.push({
          tableId: table.id,
          tableName: table.name,
          gapEndMinutes: earliestAfterRequest,
        });
      }
    }
  }

  // Sort by gap size descending (prefer tables with more time)
  gapTables.sort((a, b) => b.gapEndMinutes - a.gapEndMinutes);

  return gapTables;
}

/**
 * Send WhatsApp notification to client about their waitlist booking.
 */
async function notifyClient(
  phone: string,
  name: string,
  date: string,
  time: string,
  endTime: string,
  partySize: number,
  tableNames: string[],
  timeLimit: string | null
) {
  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

  if (!TWILIO_SID || !TWILIO_TOKEN) return;

  let whatsappTo = phone;
  if (!whatsappTo.startsWith('whatsapp:')) {
    if (!whatsappTo.startsWith('+')) whatsappTo = '+' + whatsappTo;
    whatsappTo = 'whatsapp:' + whatsappTo;
  }

  let msg = `✅ *¡Buenas noticias, ${name}!*\nSe ha liberado una mesa para ti.\n\n📅 Fecha: ${date}\n⏰ Hora: ${time}\n👥 Personas: ${partySize}`;

  if (tableNames.length > 0) {
    msg += `\n🪑 Mesas: ${tableNames.join(', ')}`;
  }

  if (timeLimit) {
    msg += `\n\n⚠️ *Importante:* La mesa está disponible hasta las ${timeLimit} ya que hay otra reserva después. Te pedimos puntualidad para disfrutar al máximo.`;
  }

  msg += `\n\nSi necesitas cancelar, escríbenos con CANCELAR.`;

  const body = new URLSearchParams({ From: TWILIO_FROM, To: whatsappTo, Body: msg });

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
    },
    body: body.toString(),
  });
}

/**
 * Send WhatsApp notification to restaurant owner.
 */
async function notifyOwner(
  guestName: string,
  date: string,
  time: string,
  partySize: number,
  tableNames: string[],
  guestPhone: string,
  isTimeLimited: boolean,
  endTime?: string
) {
  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const OWNER_PHONE = 'whatsapp:+34641790137';

  if (!TWILIO_SID || !TWILIO_TOKEN) return;

  let msg = `🔄 RESERVA DESDE LISTA DE ESPERA\n\n${guestName}\n${date} ${time}`;
  if (isTimeLimited && endTime) {
    msg += ` (hasta ${endTime} ⚠️ TIEMPO LIMITADO)`;
  }
  msg += `\n${partySize} personas\n${tableNames.join(', ')}\nTel: ${guestPhone}`;

  const body = new URLSearchParams({ From: TWILIO_FROM, To: OWNER_PHONE, Body: msg });

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
    },
    body: body.toString(),
  });
}
