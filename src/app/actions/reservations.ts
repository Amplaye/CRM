"use server";

import { db, auth } from "@/lib/firebase/admin";
import { Reservation, ReservationEvent, ReservationStatus, Guest } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { matchWaitlistForSlotAction } from "./waitlist";

/**
 * Validates the caller's Firebase Auth Token to ensure they possess 
 * the proper claims (`active_tenant_id`) to perform restricted backend tasks.
 */
async function verifyToken(idToken: string, expectedTenantId: string) {
  try {
    const decoded = await auth.verifyIdToken(idToken);
    if (decoded.active_tenant_id !== expectedTenantId && decoded.role !== 'platform_admin') {
       throw new Error("Unauthorized tenant access");
    }
    return decoded;
  } catch (error) {
    console.error("Token verification failed:", error);
    throw new Error("Authentication failed");
  }
}

/**
 * Creates a Reservation inside a Firestore Transaction.
 * Highlights:
 * 1. Checks or creates a linked Guest model natively.
 * 2. Pre-checks for identical active reservations to prevent exact double-booking.
 * 3. Appends a rigorous `reservation_events` audit event natively.
 */
export async function createReservationAction(params: {
  idToken?: string;
  adminTenantId?: string;
  tenantId: string;
  guestName: string;
  guestPhone: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  partySize: number;
  source: 'phone' | 'walk-in' | 'online' | 'staff' | 'ai_agent';
  notes?: string;
}) {
  let operatorId = "system";
  if (params.idToken) {
     const decoded = await verifyToken(params.idToken, params.tenantId);
     operatorId = decoded.uid;
  } else if (params.adminTenantId !== params.tenantId) {
     return { success: false, error: "Unauthorized webhook bypass" };
  } else {
     operatorId = "ai_agent";
  }

  try {
    return await db.runTransaction(async (transaction) => {
      // 1. Look up or create Guest
      const guestsQuery = db.collection("guests")
         .where("tenant_id", "==", params.tenantId)
         .where("phone", "==", params.guestPhone)
         .limit(1);
      
      const guestSnap = await transaction.get(guestsQuery);
      let guestId = "";
      
      if (guestSnap.empty) {
        const newGuestRef = db.collection("guests").doc();
        guestId = newGuestRef.id;
        const newGuest = {
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
        };
        transaction.set(newGuestRef, newGuest);
      } else {
        guestId = guestSnap.docs[0].id;
      }

      // 2. Prevent Double Booking (Exact time + same guest)
      const existingQ = db.collection("reservations")
         .where("tenant_id", "==", params.tenantId)
         .where("date", "==", params.date)
         .where("guest_id", "==", guestId)
         .where("status", "in", ["confirmed", "seeded", "pending_confirmation"]);
         
      const existingSnap = await transaction.get(existingQ);
      if (!existingSnap.empty) {
         throw new Error("Guest already has an active reservation on this date.");
      }

      // 3. Create Reservation
      const resRef = db.collection("reservations").doc();
      const reservationData = {
        tenant_id: params.tenantId,
        guest_id: guestId,
        date: params.date,
        time: params.time,
        party_size: params.partySize,
        status: "confirmed",
        source: params.source,
        created_by_type: params.source.startsWith("ai_") ? "ai" : "staff",
        notes: params.notes || "",
        created_at: Date.now(),
        updated_at: Date.now()
      };
      transaction.set(resRef, reservationData);

      // 4. Create Audit Event
      const eventRef = db.collection("reservation_events").doc();
      const eventData = {
        tenant_id: params.tenantId,
        reservation_id: resRef.id,
        action: "created",
        new_status: "confirmed",
        changed_by_user_id: operatorId,
        details: `Created via ${params.source}`,
        created_at: Date.now()
      };
      transaction.set(eventRef, eventData);

      return { success: true, reservationId: resRef.id };
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Mutates an existing reservation accurately logging deltas in the audit trunk.
 */
export async function updateReservationDetailsAction(params: {
  idToken?: string;
  adminTenantId?: string;
  tenantId: string;
  reservationId: string;
  data: Partial<Reservation>;
}) {
  let operatorId = "system";
  if (params.idToken) {
     const decoded = await verifyToken(params.idToken, params.tenantId);
     operatorId = decoded.uid;
  } else if (params.adminTenantId !== params.tenantId) {
     return { success: false, error: "Unauthorized webhook bypass" };
  } else {
     operatorId = "ai_agent";
  }

  try {
    const result = await db.runTransaction(async (transaction) => {
      const resRef = db.collection("reservations").doc(params.reservationId);
      const resSnap = await transaction.get(resRef);

      if (!resSnap.exists) throw new Error("Reservation not found");
      
      const current = resSnap.data() as Reservation;
      if (current.tenant_id !== params.tenantId) throw new Error("Tenant boundary violation");

      // Execute update
      transaction.update(resRef, { 
        ...params.data,
        updated_at: Date.now() 
      });

      // Determine the best audit action type
      let actionType = "time_changed"; 
      if (params.data.status && params.data.status !== current.status) actionType = "status_changed";
      if (params.data.party_size && params.data.party_size !== current.party_size) actionType = "party_size_changed";

      // Insert Audit Event
      const eventRef = db.collection("reservation_events").doc();
      transaction.set(eventRef, {
        tenant_id: params.tenantId,
        reservation_id: params.reservationId,
        action: actionType,
        previous_status: current.status,
        new_status: params.data.status || current.status,
        changed_by_user_id: operatorId,
        created_at: Date.now()
      });

      return { success: true, updatedRes: current };
    });
    
    // Auto-trigger waitlist matcher outside of the immediate transaction lock
    if (result.success && params.data.status === "cancelled" && result.updatedRes) {
       // Fire and forget, or wait for it
       await matchWaitlistForSlotAction(
         params.tenantId,
         params.reservationId,
         result.updatedRes.date,
         result.updatedRes.time,
         result.updatedRes.party_size
       );
    }
    
    return { success: result.success };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
