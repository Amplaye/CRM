// Guest segmentation — pure functions, zero I/O (vitest-friendly, same idiom
// as booking-validation.ts). Campaigns, loyalty and reviews all pick WHO to
// touch through here, so "which guests count as lapsed/VIP" has exactly one
// definition in the codebase.
//
// A segment is DATA (a small JSON literal stored in campaigns.segment), never
// code: the marketing UI builds a SegmentDef, the sender re-evaluates it at
// send time against fresh guests+reservations, and the same def can be saved,
// re-run or previewed without drift.

export interface SegmentGuest {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  visit_count: number;
  no_show_count: number;
  estimated_spend: number | null;
  tags: string[];
  /** ISO "yyyy-mm-dd" — column added by the marketing migration; null for
   * guests that never shared it. */
  birthday?: string | null;
}

/** The reservation slice segmentation needs (a projection of `reservations`). */
export interface SegmentReservation {
  guest_id: string;
  date: string; // "yyyy-mm-dd"
  status: string;
}

/** Discriminated segment definition — the JSONB stored in campaigns.segment. */
export type SegmentDef =
  | { kind: "all" }
  | { kind: "lapsed"; days: number }
  | { kind: "vip"; min_visits?: number; min_spend?: number }
  | { kind: "birthday"; month: number } // 1–12
  | { kind: "tag"; tag: string }
  | { kind: "no_show_risk"; min_no_shows?: number };

/** Statuses that prove the guest actually came. */
const VISITED = new Set(["completed", "seated"]);

/** Most recent VISITED reservation date per guest ("yyyy-mm-dd" sorts lexically). */
export function lastVisitByGuest(reservations: SegmentReservation[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const r of reservations) {
    if (!VISITED.has(r.status)) continue;
    const prev = last.get(r.guest_id);
    if (!prev || r.date > prev) last.set(r.guest_id, r.date);
  }
  return last;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** Evaluate one segment. `today` is injected ("yyyy-mm-dd") so results are
 * deterministic in tests and consistent across a whole campaign run. */
export function applySegment(
  guests: SegmentGuest[],
  reservations: SegmentReservation[],
  def: SegmentDef,
  today: string,
): SegmentGuest[] {
  switch (def.kind) {
    case "all":
      return [...guests];
    case "lapsed": {
      // Came at least once, but not in the last `days` days. Guests with zero
      // visits are prospects, not lapsed regulars — excluded on purpose.
      const last = lastVisitByGuest(reservations);
      return guests.filter((g) => {
        const lv = last.get(g.id);
        return !!lv && daysBetween(lv, today) >= def.days;
      });
    }
    case "vip": {
      // Either threshold qualifies; both unset → sane default of 5+ visits.
      const minVisits = def.min_visits ?? (def.min_spend ? Infinity : 5);
      const minSpend = def.min_spend ?? Infinity;
      return guests.filter(
        (g) => g.visit_count >= minVisits || (g.estimated_spend ?? 0) >= minSpend,
      );
    }
    case "birthday":
      return guests.filter((g) => {
        if (!g.birthday) return false;
        const m = Number(g.birthday.slice(5, 7));
        return m === def.month;
      });
    case "tag":
      return guests.filter((g) => g.tags.includes(def.tag));
    case "no_show_risk":
      return guests.filter((g) => g.no_show_count >= (def.min_no_shows ?? 2));
  }
}

/** Human key for idempotency/audit — stable across runs for the same def. */
export function segmentKey(def: SegmentDef): string {
  switch (def.kind) {
    case "all":
      return "all";
    case "lapsed":
      return `lapsed_${def.days}`;
    case "vip":
      return `vip_${def.min_visits ?? ""}_${def.min_spend ?? ""}`;
    case "birthday":
      return `birthday_${def.month}`;
    case "tag":
      return `tag_${def.tag}`;
    case "no_show_risk":
      return `noshow_${def.min_no_shows ?? 2}`;
  }
}
