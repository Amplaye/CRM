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

// Hybrid Realtime + polling-fallback. Subscribes to Supabase Realtime channels
// for reservations / waitlist_entries / conversations and refetches counts
// immediately on any change. A 5-minute setInterval acts as a safety net in
// case the websocket drops (covers wake-from-sleep and adblocker drops without
// breaking badge accuracy).
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
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Debounce realtime triggers so a burst of changes coalesces into one fetch.
    const triggerFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchCounts, 400);
    };

    fetchCounts();

    const tenantFilter = `tenant_id=eq.${tenantId}`;
    const channel = supabase
      .channel(`notif-counts-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservations", filter: tenantFilter },
        triggerFetch
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waitlist_entries", filter: tenantFilter },
        triggerFetch
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: tenantFilter },
        triggerFetch
      )
      .subscribe();

    // Safety-net polling every 5 min in case the websocket drops silently.
    const id = setInterval(fetchCounts, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(id);
      supabase.removeChannel(channel);
    };
  }, [tenantId, seenTick]);

  return counts;
}
