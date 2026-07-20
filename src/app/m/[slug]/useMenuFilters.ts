"use client";

// Shared behaviour for the four public menu templates: a fade-out → swap →
// fade-in category transition, and clickable tag filters.
//
// Both concerns live here rather than in each template because they are pure
// state machines with no visual opinion: the templates keep owning their own
// look (chip styling, grid, colours) and only read `phase` to know which CSS
// class to hang on the panel. Duplicating this four times is how the four
// templates drifted apart the last time.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How long the outgoing panel fades before the new one is mounted. Must match
 * the CSS transition the templates apply to their `.is-out` class. */
export const FADE_MS = 180;

export type TransitionPhase = "in" | "out";

type Section = { key: string; items: { tags: string[] }[] };

/**
 * Every tag that occurs at least once, in first-appearance order.
 *
 * Exported (and unit-tested) separately from the hook: an owner who never marks
 * anything vegan must not see a "Vegan" chip that empties every category, and
 * that rule is easier to guard here than through a rendered template.
 */
export function collectTags(sections: Section[]): string[] {
  const seen: string[] = [];
  for (const s of sections) {
    for (const it of s.items) {
      for (const label of it.tags) {
        if (label && !seen.includes(label)) seen.push(label);
      }
    }
  }
  return seen;
}

/** OR, not AND: "show me vegan OR spicy" is what a guest scanning for something
 * they can eat expects, and an AND returns almost nothing on a real menu. */
export function tagMatches(activeTags: string[], itemTags: string[]): boolean {
  return activeTags.length === 0 || activeTags.some((tg) => itemTags.includes(tg));
}

/**
 * Category switching with a real crossfade.
 *
 * The old panel is faded out FIRST (phase "out"), and only once that finishes
 * does `activeKey` flip and the new panel fade in. Without the two-step the
 * outgoing category disappeared in a single frame and only the incoming one
 * animated, which read as a flicker rather than a transition.
 */
export function useCategoryTransition(initialKey: string) {
  const [activeKey, setActiveKey] = useState(initialKey);
  const [phase, setPhase] = useState<TransitionPhase>("in");
  // Bumped on every swap so the panel remounts and its enter animation replays.
  const [swapKey, setSwapKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending swap must not fire after unmount, or React warns and the next
  // mount inherits a stale phase.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const select = useCallback(
    (key: string, afterSwap?: () => void) => {
      if (key === activeKey) return;
      // Guard against a double-tap landing mid-fade: cancel the in-flight swap
      // and let the newest selection win, rather than queueing two.
      if (timer.current) clearTimeout(timer.current);
      setPhase("out");
      timer.current = setTimeout(() => {
        setActiveKey(key);
        setSwapKey((n) => n + 1);
        setPhase("in");
        afterSwap?.();
      }, FADE_MS);
    },
    [activeKey],
  );

  return { activeKey, phase, swapKey, select };
}

/** Tag filtering across the whole menu — see collectTags / tagMatches above for
 * the two rules it enforces. */
export function useTagFilter<S extends Section>(sections: S[]) {
  const [activeTags, setActiveTags] = useState<string[]>([]);

  // Templates render pre-localized `tagLabels` from the server, and those labels
  // are what we filter on, so the vocabulary stays whatever the server decided.
  const availableTags = useMemo(() => collectTags(sections), [sections]);

  const toggleTag = useCallback((label: string) => {
    setActiveTags((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );
  }, []);

  const clearTags = useCallback(() => setActiveTags([]), []);

  const matches = useCallback(
    (itemTags: string[]) => tagMatches(activeTags, itemTags),
    [activeTags],
  );

  return { activeTags, availableTags, toggleTag, clearTags, matches };
}
