"use server";

import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { WaitlistEntry, WaitlistStatus, Guest, Reservation, ReservationEvent } from "@/lib/types";

/**
 * Creates a Waitlist Entry, calculating priority score dynamically.
 */
export async function createWaitlistEntryAction(params: {
  tenantId: string;
  guestId?: string;
  guestName: string;
  guestPhone: string;
  date: string;
  targetTime: string;
  partySize: number;
  timeRangeStart: string;
  timeRangeEnd: string;
  contactPreference: "whatsapp" | "sms" | "call";
  notes: string;
}) {
  // Authenticate via Supabase session
  const supabaseAuth = await createServerSupabaseClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { success: false, error: "Authentication failed" };

  const supabase = createServiceRoleClient();

  try {
    let guestId = params.guestId;
    let priorityScore = 10; // Base score

    // Guest lookup or creation
    if (!guestId) {
      const { data: existingGuests } = await supabase
        .from("guests")
        .select("id, visit_count, no_show_count")
        .eq("tenant_id", params.tenantId)
        .eq("phone", params.guestPhone)
        .limit(1);

      if (!existingGuests || existingGuests.length === 0) {
        const { data: newGuest, error: createErr } = await supabase
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

        if (createErr) throw createErr;
        guestId = newGuest.id;
      } else {
        const guestData = existingGuests[0];
        guestId = guestData.id;

        // Calculate dynamic priority
        if (guestData.visit_count > 5) priorityScore += 20;
        if (guestData.visit_count > 20) priorityScore += 30; // VIP
        if (guestData.no_show_count > 0) priorityScore -= 15; // Penalty
      }
    }

    const entry = {
      tenant_id: params.tenantId,
      guest_id: guestId!,
      date: params.date,
      target_time: params.targetTime,
      party_size: params.partySize,
      acceptable_time_range: {
        start: params.timeRangeStart,
        end: params.timeRangeEnd
      },
      contact_preference: params.contactPreference,
      priority_score: priorityScore,
      status: "waiting",
      notes: params.notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: newEntry, error: insertErr } = await supabase
      .from("waitlist_entries")
      .insert(entry)
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    return { success: true, waitlistId: newEntry.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Searches for highest priority matching waitlist entries given a cancelled slot.
 * Called automatically by Reservation engine when a booking is cancelled.
 */
export async function matchWaitlistForSlotAction(
  tenantId: string,
  cancelledResId: string,
  date: string,
  time: string,
  freedPartySize: number
) {
  const supabase = createServiceRoleClient();

  try {
    const { data: waitlistEntries, error: fetchErr } = await supabase
      .from("waitlist_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("date", date)
      .eq("status", "waiting");

    if (fetchErr) throw fetchErr;
    if (!waitlistEntries || waitlistEntries.length === 0) return { success: true, matched: 0 };

    const candidates: Array<{ id: string; data: WaitlistEntry }> = [];

    for (const entry of waitlistEntries) {
      // Time range check
      if (time >= entry.acceptable_time_range.start && time <= entry.acceptable_time_range.end) {
        // Capacity check (+/- 1 person tolerance)
        if (entry.party_size <= freedPartySize && entry.party_size >= freedPartySize - 1) {
          candidates.push({ id: entry.id, data: entry as WaitlistEntry });
        }
      }
    }

    if (candidates.length === 0) return { success: true, matched: 0 };

    // Sort by priority DESC, then oldest first
    candidates.sort((a, b) => {
      if (b.data.priority_score !== a.data.priority_score) {
        return b.data.priority_score - a.data.priority_score;
      }
      return new Date(a.data.created_at).getTime() - new Date(b.data.created_at).getTime();
    });

    const bestMatch = candidates[0];

    // Flag the waitlist entry as match_found
    const { error: updateErr } = await supabase
      .from("waitlist_entries")
      .update({
        status: "match_found",
        matched_reservation_id: cancelledResId,
        updated_at: new Date().toISOString()
      })
      .eq("id", bestMatch.id);

    if (updateErr) throw updateErr;

    // Add a system event to reservation events to track recovery attempt
    const { error: eventErr } = await supabase
      .from("reservation_events")
      .insert({
        tenant_id: tenantId,
        reservation_id: cancelledResId,
        action: "note_added",
        details: `System automatically matched waitlist candidate [${bestMatch.id}] for recovery.`,
        changed_by_user_id: "system",
        created_at: new Date().toISOString()
      });

    if (eventErr) throw eventErr;

    return { success: true, matchedCount: 1, matchedListId: bestMatch.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Updates waitlist status manually (e.g staff contacted them, or converting to booking)
 */
export async function updateWaitlistStatusAction(params: {
  tenantId: string;
  waitlistId: string;
  newStatus: WaitlistStatus;
  notes?: string;
}) {
  // Authenticate via Supabase session
  const supabaseAuth = await createServerSupabaseClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return { success: false, error: "Authentication failed" };

  const supabase = createServiceRoleClient();

  try {
    const updates: any = {
      status: params.newStatus,
      updated_at: new Date().toISOString()
    };
    if (params.notes) {
      updates.notes = params.notes;
    }

    const { error } = await supabase
      .from("waitlist_entries")
      .update(updates)
      .eq("id", params.waitlistId);

    if (error) throw error;

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
