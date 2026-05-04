"use server";

import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { Reservation, ReservationEvent, ReservationStatus, Guest } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { matchWaitlistForSlotAction } from "./waitlist";
import { getShift, getRotationMinutes, calculateEndTime, tablesNeeded } from "@/lib/restaurant-rules";

/**
 * Creates a Reservation.
 * Highlights:
 * 1. Checks or creates a linked Guest model.
 * 2. Pre-checks for identical active reservations to prevent exact double-booking.
 * 3. Appends a rigorous `reservation_events` audit event.
 */
export async function createReservationAction(params: {
  adminTenantId?: string;
  tenantId: string;
  guestName: string;
  guestPhone: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  partySize: number;
  source: 'phone' | 'walk-in' | 'online' | 'staff' | 'ai_agent';
  notes?: string;
  shift?: string;
}) {
  let operatorId = "system";

  // If called from a server action context (user-initiated), get user from session
  if (!params.adminTenantId) {
    try {
      const supabaseAuth = await createServerSupabaseClient();
      const { data: { user } } = await supabaseAuth.auth.getUser();
      if (user) {
        operatorId = user.id;
      } else {
        return { success: false, error: "Authentication failed" };
      }
    } catch {
      return { success: false, error: "Authentication failed" };
    }
  } else if (params.adminTenantId !== params.tenantId) {
    return { success: false, error: "Unauthorized webhook bypass" };
  } else {
    operatorId = "ai_agent";
  }

  // Use service role client for all DB operations (bypasses RLS for server actions)
  const supabase = createServiceRoleClient();

  try {
    // 1. Look up or create Guest
    const { data: existingGuests, error: guestLookupErr } = await supabase
      .from("guests")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("phone", params.guestPhone)
      .limit(1);

    if (guestLookupErr) throw guestLookupErr;

    let guestId = "";

    if (!existingGuests || existingGuests.length === 0) {
      const { data: newGuest, error: createGuestErr } = await supabase
        .from("guests")
        .insert({
          tenant_id: params.tenantId,
          name: params.guestName,
          phone: params.guestPhone,
          visit_count: 0,
          no_show_count: 0,
          cancellation_count: 0,
          tags: [],
          notes: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select("id")
        .single();

      if (createGuestErr) throw createGuestErr;
      guestId = newGuest.id;
    } else {
      guestId = existingGuests[0].id;
    }

    // 2. Prevent Double Booking (same guest, same date, active status)
    const { data: existingRes, error: dupCheckErr } = await supabase
      .from("reservations")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("date", params.date)
      .eq("guest_id", guestId)
      .in("status", ["confirmed", "seated", "pending_confirmation"])
      .limit(1);

    if (dupCheckErr) throw dupCheckErr;
    if (existingRes && existingRes.length > 0) {
      throw new Error("Guest already has an active reservation on this date.");
    }

    // 3. Create Reservation
    const computedShift = params.shift || getShift(params.time);
    const dayOfWeek = new Date(params.date + 'T12:00:00').getDay();
    const rotation = getRotationMinutes(params.partySize, computedShift as 'lunch' | 'dinner', dayOfWeek);
    const endTime = calculateEndTime(params.time, rotation);

    const { data: newRes, error: createResErr } = await supabase
      .from("reservations")
      .insert({
        tenant_id: params.tenantId,
        guest_id: guestId,
        date: params.date,
        time: params.time,
        party_size: params.partySize,
        status: "confirmed",
        source: params.source,
        created_by_type: params.source.startsWith("ai_") ? "ai" : "staff",
        notes: params.notes || "",
        shift: computedShift,
        end_time: endTime,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select("id")
      .single();

    if (createResErr) throw createResErr;

    // 3b. Atomic table assignment — distributes party across multiple tables when needed
    const needed = tablesNeeded(params.partySize);
    const { data: atomicResult, error: atomicErr } = await supabase.rpc('atomic_book_tables', {
      p_tenant_id: params.tenantId,
      p_date: params.date,
      p_shift: computedShift,
      p_tables_needed: needed,
      p_reservation_id: newRes.id,
    });

    if (atomicErr) throw atomicErr;

    if (!atomicResult?.success) {
      // Not enough tables — flag as escalated so staff can review
      await supabase.from('reservations').update({
        status: 'escalated',
        notes: (params.notes || '') + ' — No hay suficientes mesas, pendiente de revisión',
      }).eq('id', newRes.id);
    }

    // 4. Create Audit Event
    const { error: eventErr } = await supabase
      .from("reservation_events")
      .insert({
        tenant_id: params.tenantId,
        reservation_id: newRes.id,
        action: "created",
        new_status: "confirmed",
        changed_by_user_id: operatorId,
        details: `Created via ${params.source}`,
        created_at: new Date().toISOString()
      });

    if (eventErr) throw eventErr;

    // 5. Mirror to audit_events so downstream consumers (n8n reminders,
    // follow-up cron) see manual bookings the same way they see AI-agent
    // bookings. The /api/ai/book route writes this row for AI sources;
    // without it, staff-created reservations were invisible to the
    // reminder/follow-up pipeline.
    const auditSource: 'ai_agent' | 'staff' | 'system' =
      params.source === 'ai_agent' ? 'ai_agent'
      : (params.source === 'staff' || params.source === 'phone' || params.source === 'walk-in' || params.source === 'online') ? 'staff'
      : 'system';
    await supabase.from('audit_events').insert({
      tenant_id: params.tenantId,
      action: 'create_reservation',
      entity_id: newRes.id,
      source: auditSource,
      details: {
        date: params.date,
        time: params.time,
        party_size: params.partySize,
        shift: computedShift,
        end_time: endTime,
        booking_source: params.source,
      },
      created_at: new Date().toISOString(),
    });

    return { success: true, reservationId: newRes.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Mutates an existing reservation accurately logging deltas in the audit trunk.
 */
export async function updateReservationDetailsAction(params: {
  adminTenantId?: string;
  tenantId: string;
  reservationId: string;
  data: Partial<Reservation>;
}) {
  let operatorId = "system";

  if (!params.adminTenantId) {
    try {
      const supabaseAuth = await createServerSupabaseClient();
      const { data: { user } } = await supabaseAuth.auth.getUser();
      if (user) {
        operatorId = user.id;
      } else {
        return { success: false, error: "Authentication failed" };
      }
    } catch {
      return { success: false, error: "Authentication failed" };
    }
  } else if (params.adminTenantId !== params.tenantId) {
    return { success: false, error: "Unauthorized webhook bypass" };
  } else {
    operatorId = "ai_agent";
  }

  const supabase = createServiceRoleClient();

  try {
    // Fetch existing reservation
    const { data: current, error: fetchErr } = await supabase
      .from("reservations")
      .select("*")
      .eq("id", params.reservationId)
      .single();

    if (fetchErr || !current) throw new Error("Reservation not found");
    if (current.tenant_id !== params.tenantId) throw new Error("Tenant boundary violation");

    // Execute update — when staff/operator cancels, tag the source so the
    // dashboard's "No-Shows Prevented" KPI is not distorted by NULLs.
    const updatePayload: any = {
      ...params.data,
      updated_at: new Date().toISOString()
    };
    if (
      params.data.status === "cancelled" &&
      params.data.status !== current.status &&
      !(params.data as any).cancellation_source
    ) {
      updatePayload.cancellation_source = operatorId === "ai_agent" ? "ai_voice" : "staff";
    }

    const { error: updateErr } = await supabase
      .from("reservations")
      .update(updatePayload)
      .eq("id", params.reservationId);

    if (updateErr) throw updateErr;

    // Determine the best audit action type
    let actionType = "time_changed";
    if (params.data.status && params.data.status !== current.status) actionType = "status_changed";
    if (params.data.party_size && params.data.party_size !== current.party_size) actionType = "party_size_changed";

    // Insert Audit Event
    const { error: eventErr } = await supabase
      .from("reservation_events")
      .insert({
        tenant_id: params.tenantId,
        reservation_id: params.reservationId,
        action: actionType,
        previous_status: current.status,
        new_status: params.data.status || current.status,
        changed_by_user_id: operatorId,
        created_at: new Date().toISOString()
      });

    if (eventErr) throw eventErr;

    // Log a booking-detail modification so the CRM notification bell picks it up
    const dateChanged = params.data.date && params.data.date !== current.date;
    const timeChanged = params.data.time && params.data.time !== current.time;
    const sizeChanged = params.data.party_size && params.data.party_size !== current.party_size;
    const notesChanged = params.data.notes !== undefined && params.data.notes !== current.notes;
    if (dateChanged || timeChanged || sizeChanged || notesChanged) {
      await supabase.from("audit_events").insert({
        tenant_id: params.tenantId,
        action: "modify_reservation",
        entity_id: params.reservationId,
        source: operatorId === "ai_agent" ? "ai_agent" : "staff",
        details: {
          previous: { date: current.date, time: current.time, party_size: current.party_size, notes: current.notes },
          updates: {
            ...(dateChanged ? { date: params.data.date } : {}),
            ...(timeChanged ? { time: params.data.time } : {}),
            ...(sizeChanged ? { party_size: params.data.party_size } : {}),
            ...(notesChanged ? { notes: params.data.notes } : {}),
          },
        },
        created_at: new Date().toISOString(),
      });
    }

    // Auto-trigger waitlist matcher when a booking is cancelled
    if (params.data.status === "cancelled") {
      await matchWaitlistForSlotAction(
        params.tenantId,
        params.reservationId,
        current.date,
        current.time,
        current.party_size
      );
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
