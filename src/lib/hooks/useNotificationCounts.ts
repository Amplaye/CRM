"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { getLastSeen, Section } from "./useLastSeen";

export interface NotificationCounts {
  pending: number; // escalated reservations awaiting manual confirm
  waitlist: number; // waiting waitlist entries
  conversations: number; // active+escalated conversations needing attention
  reservations: number; // today's confirmed/seated/pending bookings (informational)
}

const ZERO: NotificationCounts = { pending: 0, waitlist: 0, conversations: 0, reservations: 0 };

// Polls Supabase every 30s for counts of items that need staff attention.
// Each count is filtered by created_at > lastSeen[tenantId, section] so
// badges only show NEW items since the user's last visit to that section.
// Cheap query: HEAD requests with count='exact' on indexed columns.
export function useNotificationCounts(tenantId?: string | null): NotificationCounts {
  const [counts, setCounts] = useState<NotificationCounts>(ZERO);
  const [seenTick, setSeenTick] = useState(0);
  const supabaseRef = useRef(createClient());

  // Bump on lastSeen changes so we re-fetch immediately when user opens a section.
  useEffect(() => {
    const onChange = () => setSeenTick((n) => n + 1);
    window.addEventListener("lastSeenChanged", onChange);
    return () => window.removeEventListener("lastSeenChanged", onChange);
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setCounts(ZERO);
      return;
    }

    const supabase = supabaseRef.current;
    let cancelled = false;

    const fetchCounts = async () => {
      const today = new Date().toISOString().split("T")[0];
      const seen = (s: Section) => getLastSeen(tenantId, s);

      const [pendingRes, waitlistRes, convosRes, resvRes] = await Promise.all([
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "escalated")
          .gt("created_at", seen("pending")),
        supabase
          .from("waitlist_entries")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("status", "waiting")
          .gt("created_at", seen("waitlist")),
        supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .or("status.eq.escalated,escalation_flag.eq.true")
          .gt("updated_at", seen("conversations")),
        supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("date", today)
          .in("status", ["confirmed", "pending_confirmation", "seated"])
          .gt("created_at", seen("reservations")),
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
  }, [tenantId, seenTick]);

  return counts;
}
