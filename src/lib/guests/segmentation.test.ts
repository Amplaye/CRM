import { describe, expect, it } from "vitest";
import {
  applySegment,
  lastVisitByGuest,
  segmentKey,
  type SegmentGuest,
  type SegmentReservation,
} from "./segmentation";

const g = (over: Partial<SegmentGuest> & { id: string }): SegmentGuest => ({
  name: over.id,
  phone: "+34600000000",
  email: null,
  visit_count: 0,
  no_show_count: 0,
  estimated_spend: null,
  tags: [],
  birthday: null,
  ...over,
});

const TODAY = "2026-07-10";

const guests: SegmentGuest[] = [
  g({ id: "ana", visit_count: 7, estimated_spend: 40, tags: ["vip"] }),
  g({ id: "bea", visit_count: 2, birthday: "1990-07-22" }),
  g({ id: "carl", visit_count: 1, no_show_count: 3 }),
  g({ id: "dora", visit_count: 0, estimated_spend: 900 }),
];

const reservations: SegmentReservation[] = [
  { guest_id: "ana", date: "2026-07-01", status: "completed" },
  { guest_id: "ana", date: "2026-03-01", status: "completed" },
  { guest_id: "bea", date: "2026-02-15", status: "completed" },
  { guest_id: "bea", date: "2026-06-30", status: "cancelled" }, // not a visit
  { guest_id: "carl", date: "2026-01-10", status: "seated" },
];

describe("lastVisitByGuest", () => {
  it("keeps only the most recent visited date and ignores non-visits", () => {
    const last = lastVisitByGuest(reservations);
    expect(last.get("ana")).toBe("2026-07-01");
    expect(last.get("bea")).toBe("2026-02-15"); // cancelled 06-30 ignored
    expect(last.get("carl")).toBe("2026-01-10");
    expect(last.has("dora")).toBe(false);
  });
});

describe("applySegment", () => {
  it("all returns everyone (a copy)", () => {
    const out = applySegment(guests, reservations, { kind: "all" }, TODAY);
    expect(out).toHaveLength(4);
    expect(out).not.toBe(guests);
  });

  it("lapsed = visited before, absent >= N days; never-visited excluded", () => {
    const out = applySegment(guests, reservations, { kind: "lapsed", days: 90 }, TODAY);
    expect(out.map((x) => x.id).sort()).toEqual(["bea", "carl"]);
    // ana visited 9 days ago → not lapsed at 90; dora never visited → excluded
    const out30 = applySegment(guests, reservations, { kind: "lapsed", days: 5 }, TODAY);
    expect(out30.map((x) => x.id).sort()).toEqual(["ana", "bea", "carl"]);
  });

  it("vip matches by visits OR spend; defaults to 5+ visits", () => {
    expect(applySegment(guests, reservations, { kind: "vip" }, TODAY).map((x) => x.id)).toEqual(["ana"]);
    const bySpend = applySegment(guests, reservations, { kind: "vip", min_spend: 500 }, TODAY);
    expect(bySpend.map((x) => x.id)).toEqual(["dora"]);
    const both = applySegment(guests, reservations, { kind: "vip", min_visits: 5, min_spend: 500 }, TODAY);
    expect(both.map((x) => x.id).sort()).toEqual(["ana", "dora"]);
  });

  it("birthday filters by month, skipping guests without one", () => {
    const out = applySegment(guests, reservations, { kind: "birthday", month: 7 }, TODAY);
    expect(out.map((x) => x.id)).toEqual(["bea"]);
    expect(applySegment(guests, reservations, { kind: "birthday", month: 12 }, TODAY)).toEqual([]);
  });

  it("tag and no_show_risk", () => {
    expect(applySegment(guests, reservations, { kind: "tag", tag: "vip" }, TODAY).map((x) => x.id)).toEqual(["ana"]);
    expect(
      applySegment(guests, reservations, { kind: "no_show_risk" }, TODAY).map((x) => x.id),
    ).toEqual(["carl"]);
  });
});

describe("segmentKey", () => {
  it("is stable and unique per definition", () => {
    expect(segmentKey({ kind: "lapsed", days: 90 })).toBe("lapsed_90");
    expect(segmentKey({ kind: "birthday", month: 7 })).toBe("birthday_7");
    expect(segmentKey({ kind: "tag", tag: "vip" })).toBe("tag_vip");
  });
});
