// Server-side loyalty accrual — called when a reservation transitions to
// 'completed' (updateReservationDetailsAction). Best-effort by contract: a
// loyalty hiccup must NEVER fail the reservation update. Idempotent via the
// partial unique index uq_loyalty_events_accrual_reservation (one positive
// event per reservation), so re-completing a booking can't double-earn.

import { getFeatures, type TenantSettings } from "@/lib/types/tenant-settings";
import { getLoyaltyConfig } from "./loyalty";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any; // service-role Supabase client (same loose typing as deposits)

export async function accrueVisitPoints(
  svc: Svc,
  params: {
    tenantId: string;
    guestId: string;
    reservationId: string;
    settings: TenantSettings | null | undefined;
  },
): Promise<void> {
  try {
    if (!getFeatures(params.settings).loyalty_enabled) return;
    const cfg = getLoyaltyConfig(params.settings);

    // Ledger first: the unique index arbitrates idempotency. 23505 = this
    // reservation already earned its points → stop silently.
    const { error: evErr } = await svc.from("loyalty_events").insert({
      tenant_id: params.tenantId,
      guest_id: params.guestId,
      reservation_id: params.reservationId,
      points_delta: cfg.points_per_visit,
      reason: "visit_completed",
    });
    if (evErr) {
      if (evErr.code !== "23505") {
        console.error("[loyalty] accrual event insert failed", evErr.message);
      }
      return;
    }

    // Balance: read-modify-write is fine here — accruals for one guest are
    // serialized by the human act of completing their reservation.
    const { data: account } = await svc
      .from("loyalty_accounts")
      .select("id, points")
      .eq("tenant_id", params.tenantId)
      .eq("guest_id", params.guestId)
      .maybeSingle();
    if (account) {
      await svc
        .from("loyalty_accounts")
        .update({ points: account.points + cfg.points_per_visit, updated_at: new Date().toISOString() })
        .eq("id", account.id);
    } else {
      const { error: insErr } = await svc.from("loyalty_accounts").insert({
        tenant_id: params.tenantId,
        guest_id: params.guestId,
        points: cfg.points_per_visit,
      });
      // 23505 = concurrent first-accrual created the account — add onto it.
      if (insErr?.code === "23505") {
        const { data: raced } = await svc
          .from("loyalty_accounts")
          .select("id, points")
          .eq("tenant_id", params.tenantId)
          .eq("guest_id", params.guestId)
          .maybeSingle();
        if (raced) {
          await svc
            .from("loyalty_accounts")
            .update({ points: raced.points + cfg.points_per_visit, updated_at: new Date().toISOString() })
            .eq("id", raced.id);
        }
      }
    }
  } catch (e) {
    console.error("[loyalty] accrual failed", e instanceof Error ? e.message : e);
  }
}
