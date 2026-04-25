"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export interface NotificationCounts {
  pending: number; // escalated reservations awaiting manual confirm
  waitlist: number; // waiting waitlist entries
  conversations: number; // active+escalated conversations needing attention
  reservations: number; // today's confirmed/seated/pending bookings (informational)
}

const ZERO: NotificationCounts = { pending: 0, waitlist: 0, conversations: 0, reservations: 0 };

// Polls Supabase every 30s for counts of items that need staff attention.
// Cheap query: HEAD requests with count='exact' on indexed columns.
export function useNotificationCounts(tenantId?: string | null): NotificationCounts {
  const [counts, setCounts] = useState<NotificationCounts>(ZERO);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    if (!tenantId) {
      setCounts(ZERO);
      return;
    }

    const supabase = supabaseRef.current;
    let cancelled = false;

    const fetchCounts = async () => {
      const today = new Date().toISOString().split("T")[0];

      const [pendingRes, waitlistRes, convosRes, resvRes] = await Promise.all([
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "escalated"),
        supabase
          .from("waitlist_entries")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "waiting"),
        supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .or("status.eq.escalated,escalation_flag.eq.true"),
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("date", today)
          .in("status", ["confirmed", "pending_confirmation", "seated"]),
      ]);

      if (cancelled) return;
      setCounts({
        pending: pendingRes.count ?? 0,
        waitlist: waitlistRes.count ?? 0,
        conversations: convosRes.count ?? 0,
        reservations: resvRes.count ?? 0,
      });
    };

    fetchCounts();
    const id = setInterval(fetchCounts, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tenantId]);

  return counts;
}
