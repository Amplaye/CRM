"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Tracks whether the user has ever *physically opened* a given nav section,
 * scoped per tenant. This powers the post-onboarding "discovery dot" in the
 * sidebar: a small marker next to sections a freshly-installed user hasn't
 * visited yet, nudging them to explore the whole CRM. The dot disappears the
 * moment the section is opened — including locked (paid) sections, where
 * clicking still counts as "visited" even though the page stays gated.
 *
 * This is intentionally separate from useLastSeen: lastSeen is a *timestamp*
 * driving the numeric "new activity" badges, whereas this is a one-way
 * "have you ever been here?" boolean that never comes back once set.
 */
const KEY_PREFIX = "visitedSection";
const EVENT = "visitedSectionChanged";

const storageKey = (tenantId: string, href: string) =>
  `${KEY_PREFIX}_${tenantId}_${href}`;

export function isVisited(tenantId: string, href: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(storageKey(tenantId, href)) === "1";
  } catch {
    return true;
  }
}

export function markVisited(tenantId: string, href: string) {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(storageKey(tenantId, href)) === "1") return;
    window.localStorage.setItem(storageKey(tenantId, href), "1");
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { tenantId, href } }));
  } catch {}
}

/**
 * Returns a Set of hrefs the user has already visited for this tenant, kept in
 * sync across components via the custom event. The sidebar reads this to decide
 * which items still deserve a discovery dot.
 */
export function useVisitedSections(
  tenantId: string | null | undefined,
  hrefs: string[]
): { visited: Set<string>; mark: (href: string) => void } {
  const computeVisited = useCallback(() => {
    const s = new Set<string>();
    if (!tenantId) return s;
    for (const h of hrefs) {
      if (isVisited(tenantId, h)) s.add(h);
    }
    return s;
    // hrefs is stable (module-level nav list) — join to keep deps simple.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, hrefs.join("|")]);

  const [visited, setVisited] = useState<Set<string>>(computeVisited);

  useEffect(() => {
    setVisited(computeVisited());
    if (!tenantId) return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tenantId === tenantId) setVisited(computeVisited());
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [tenantId, computeVisited]);

  const mark = useCallback(
    (href: string) => {
      if (tenantId) markVisited(tenantId, href);
    },
    [tenantId]
  );

  return { visited, mark };
}
