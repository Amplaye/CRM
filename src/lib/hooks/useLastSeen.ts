"use client";

import { useCallback, useEffect, useState } from "react";

const KEY_PREFIX = "lastSeen";

export type Section = "pending" | "waitlist" | "conversations" | "reservations";

const storageKey = (tenantId: string, section: Section) =>
  `${KEY_PREFIX}_${tenantId}_${section}`;

export function getLastSeen(tenantId: string, section: Section): string {
  if (typeof window === "undefined") return new Date(0).toISOString();
  try {
    return window.localStorage.getItem(storageKey(tenantId, section)) ||
      new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

export function setLastSeen(tenantId: string, section: Section, when: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tenantId, section), when);
    // Notify other components in this tab (Sidebar etc.) that the value changed.
    window.dispatchEvent(new CustomEvent("lastSeenChanged", { detail: { tenantId, section, when } }));
  } catch {}
}

// Returns the lastSeen timestamp for this (tenant, section) and a function
// to mark the section as seen NOW. Marking now triggers a re-render of any
// component using useNotificationCounts so badges drop to 0 immediately.
export function useLastSeen(tenantId: string | null | undefined, section: Section) {
  const [lastSeen, setLocal] = useState<string>(() =>
    tenantId ? getLastSeen(tenantId, section) : new Date(0).toISOString()
  );

  useEffect(() => {
    if (!tenantId) return;
    setLocal(getLastSeen(tenantId, section));

    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tenantId === tenantId && detail?.section === section) {
        setLocal(detail.when);
      }
    };
    window.addEventListener("lastSeenChanged", onChange);
    return () => window.removeEventListener("lastSeenChanged", onChange);
  }, [tenantId, section]);

  const markSeen = useCallback(() => {
    if (!tenantId) return;
    const now = new Date().toISOString();
    setLastSeen(tenantId, section, now);
  }, [tenantId, section]);

  return { lastSeen, markSeen };
}

// Helper for pages: snapshot the lastSeen value AT MOUNT (so we can highlight
// rows newer than that), then mark the section as seen so badges clear.
// Returns the snapshot — anything with created_at > snapshot should "pop".
export function useSeenSnapshotAndMark(
  tenantId: string | null | undefined,
  section: Section
): string {
  const { lastSeen, markSeen } = useLastSeen(tenantId, section);
  const [snapshot] = useState(lastSeen);

  useEffect(() => {
    if (!tenantId) return;
    // Mark seen on mount so the badge clears as soon as user opens the page.
    markSeen();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, section]);

  return snapshot;
}
