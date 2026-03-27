"use server";

import { db, auth } from "@/lib/firebase/admin";
import { WaitlistEntry, WaitlistStatus, Guest, Reservation, ReservationEvent } from "@/lib/types";

async function verifyToken(idToken: string, expectedTenantId: string) {
  try {
    const decoded = await auth.verifyIdToken(idToken);
    if (decoded.active_tenant_id !== expectedTenantId && decoded.role !== 'platform_admin') {
       throw new Error("Unauthorized tenant access");
    }
    return decoded;
  } catch (error) {
    throw new Error("Authentication failed");
  }
}

/**
 * Creates a Waitlist Entry, calculating priority score dynamically.
 */
export async function createWaitlistEntryAction(params: {
  idToken: string;
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
  const decoded = await verifyToken(params.idToken, params.tenantId);
  
  try {
    return await db.runTransaction(async (transaction) => {
      let guestId = params.guestId;
      let priorityScore = 10; // Base score
      
      // Guest lookup or creation
      if (!guestId) {
         const guestsQuery = db.collection("guests")
           .where("tenant_id", "==", params.tenantId)
           .where("phone", "==", params.guestPhone)
           .limit(1);
         const guestSnap = await transaction.get(guestsQuery);
         
         if (guestSnap.empty) {
           const newGuestRef = db.collection("guests").doc();
           guestId = newGuestRef.id;
           transaction.set(newGuestRef, {
             tenant_id: params.tenantId,
             name: params.guestName,
             phone: params.guestPhone,
             visit_count: 0,
             no_show_count: 0,
             cancellation_count: 0,
             tags: [],
             notes: "",
             created_at: Date.now(),
             updated_at: Date.now()
           });
         } else {
           const guestDoc = guestSnap.docs[0];
           guestId = guestDoc.id;
           const guestData = guestDoc.data() as Guest;
           
           // Calculate dynamic priority
           if (guestData.visit_count > 5) priorityScore += 20;
           if (guestData.visit_count > 20) priorityScore += 30; // VIP
           if (guestData.no_show_count > 0) priorityScore -= 15; // Penalty
         }
      }

      const wRef = db.collection("waitlist_entries").doc();
      const entry: Partial<WaitlistEntry> = {
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
         created_at: Date.now(),
         updated_at: Date.now()
      };
      
      transaction.set(wRef, entry);
      return { success: true, waitlistId: wRef.id };
    });
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
  try {
     // Run transaction to ensure we safely lock and assign matches
     return await db.runTransaction(async (transaction) => {
        const q = db.collection("waitlist_entries")
          .where("tenant_id", "==", tenantId)
          .where("date", "==", date)
          .where("status", "==", "waiting");

        const snap = await transaction.get(q);
        if (snap.empty) return { success: true, matched: 0 };

        const candidates: Array<{ id: string; data: WaitlistEntry }> = [];
        
        snap.forEach(doc => {
           const data = doc.data() as WaitlistEntry;
           
           // Time range check
           // E.g. freed time "19:00", acceptable "18:00" - "20:00"
           if (time >= data.acceptable_time_range.start && time <= data.acceptable_time_range.end) {
              // Capacity check (+/- 1 person tolerance depending on business rules, let's say strict exact or smaller)
              if (data.party_size <= freedPartySize && data.party_size >= freedPartySize - 1) {
                 candidates.push({ id: doc.id, data });
              }
           }
        });

        if (candidates.length === 0) return { success: true, matched: 0 };

        // Sort by priority DESC, then oldest first
        candidates.sort((a, b) => {
           if (b.data.priority_score !== a.data.priority_score) {
              return b.data.priority_score - a.data.priority_score;
           }
           return a.data.created_at - b.data.created_at;
        });

        const bestMatch = candidates[0];

        // Flag the waitlist entry as match_found
        const wRef = db.collection("waitlist_entries").doc(bestMatch.id);
        transaction.update(wRef, {
           status: "match_found",
           matched_reservation_id: cancelledResId,
           updated_at: Date.now()
        });

        // Add a system event to reservation events to track recovery attempt
        const eventRef = db.collection("reservation_events").doc();
        transaction.set(eventRef, {
           tenant_id: tenantId,
           reservation_id: cancelledResId,
           action: "note_added",
           details: `System automatically matched waitlist candidate [${bestMatch.id}] for recovery.`,
           changed_by_user_id: "system",
           created_at: Date.now()
        });

        return { success: true, matchedCount: 1, matchedListId: bestMatch.id };
     });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Updates waitlist status manually (e.g staff contacted them, or converting to booking)
 */
export async function updateWaitlistStatusAction(params: {
  idToken: string;
  tenantId: string;
  waitlistId: string;
  newStatus: WaitlistStatus;
  notes?: string;
}) {
  const decoded = await verifyToken(params.idToken, params.tenantId);
  try {
     const wRef = db.collection("waitlist_entries").doc(params.waitlistId);
     const updates: any = {
        status: params.newStatus,
        updated_at: Date.now()
     };
     if (params.notes) {
        updates.notes = params.notes; // Overwrite or append based on logic
     }
     await wRef.update(updates);
     return { success: true };
  } catch (e: any) {
     return { success: false, error: e.message };
  }
}
