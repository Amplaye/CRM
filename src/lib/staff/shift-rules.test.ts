import { describe, expect, it } from "vitest";
import {
  addDays, bandPreset, datesInRange, findConflict, spansOverlap, timeToMin,
  validateShiftInput, weekdayDatesInWeek, weekdayIndex,
} from "./shift-rules";

describe("timeToMin", () => {
  it("parses HH:MM and HH:MM:SS", () => {
    expect(timeToMin("09:30")).toBe(570);
    expect(timeToMin("19:00:00")).toBe(1140);
    expect(timeToMin("00:00")).toBe(0);
  });
});

describe("spansOverlap", () => {
  it("detects plain overlaps", () => {
    expect(spansOverlap({ start_time: "12:00", end_time: "16:00" }, { start_time: "15:00", end_time: "18:00" })).toBe(true);
  });

  it("back-to-back shifts do not overlap", () => {
    expect(spansOverlap({ start_time: "12:00", end_time: "16:00" }, { start_time: "16:00", end_time: "23:00" })).toBe(false);
  });

  it("handles a midnight-crossing dinner", () => {
    // 19:00–01:00 overlaps 23:00–02:00, but not 09:00–12:00
    expect(spansOverlap({ start_time: "19:00", end_time: "01:00" }, { start_time: "23:00", end_time: "02:00" })).toBe(true);
    expect(spansOverlap({ start_time: "19:00", end_time: "01:00" }, { start_time: "09:00", end_time: "12:00" })).toBe(false);
  });
});

describe("findConflict", () => {
  const existing = [
    { id: "s1", member_id: "m1", work_date: "2026-07-10", start_time: "12:00", end_time: "16:00", status: "scheduled" },
    { id: "s2", member_id: "m1", work_date: "2026-07-10", start_time: "19:00", end_time: "23:30", status: "cancelled" },
    { id: "s3", member_id: "m2", work_date: "2026-07-10", start_time: "12:00", end_time: "16:00", status: "scheduled" },
  ];

  it("flags a double booking for the same member/date/hours", () => {
    const c = findConflict(existing, { member_id: "m1", work_date: "2026-07-10", start_time: "15:00", end_time: "18:00" });
    expect(c?.id).toBe("s1");
  });

  it("ignores cancelled shifts, other members and other dates", () => {
    expect(findConflict(existing, { member_id: "m1", work_date: "2026-07-10", start_time: "19:00", end_time: "23:00" })).toBeNull();
    expect(findConflict(existing, { member_id: "m3", work_date: "2026-07-10", start_time: "12:00", end_time: "16:00" })).toBeNull();
    expect(findConflict(existing, { member_id: "m1", work_date: "2026-07-11", start_time: "12:00", end_time: "16:00" })).toBeNull();
  });

  it("skips the row being edited (same id)", () => {
    expect(findConflict(existing, { id: "s1", member_id: "m1", work_date: "2026-07-10", start_time: "13:00", end_time: "17:00" })).toBeNull();
  });
});

describe("validateShiftInput", () => {
  const ok = { work_date: "2026-07-10", band: "dinner", start_time: "19:00", end_time: "23:30" };

  it("accepts a normal shift", () => {
    expect(validateShiftInput(ok)).toBeNull();
  });

  it("accepts a midnight-crossing shift", () => {
    expect(validateShiftInput({ ...ok, start_time: "19:00", end_time: "01:00" })).toBeNull();
  });

  it("rejects bad date / band / time formats", () => {
    expect(validateShiftInput({ ...ok, work_date: "10/07/2026" })).toBe("invalid_date");
    expect(validateShiftInput({ ...ok, band: "night" })).toBe("invalid_band");
    expect(validateShiftInput({ ...ok, start_time: "7pm" })).toBe("invalid_time");
  });

  it("rejects degenerate durations", () => {
    expect(validateShiftInput({ ...ok, start_time: "19:00", end_time: "19:10" })).toBe("too_short");
    expect(validateShiftInput({ ...ok, start_time: "05:00", end_time: "04:00" })).toBe("too_long");
  });
});

describe("bandPreset", () => {
  it("returns standard hours per band", () => {
    expect(bandPreset("lunch")).toEqual({ start_time: "12:00", end_time: "16:00" });
    expect(bandPreset("dinner")).toEqual({ start_time: "19:00", end_time: "23:30" });
    expect(bandPreset("all")).toEqual({ start_time: "12:00", end_time: "23:30" });
  });
});

describe("weekdayIndex", () => {
  it("maps Mon=0 … Sun=6", () => {
    // 2026-07-06 is a Monday.
    expect(weekdayIndex("2026-07-06")).toBe(0);
    expect(weekdayIndex("2026-07-07")).toBe(1); // Tue
    expect(weekdayIndex("2026-07-12")).toBe(6); // Sun
  });
});

describe("addDays", () => {
  it("adds/subtracts days without tz drift, crossing a month", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("datesInRange", () => {
  it("lists every day inclusive", () => {
    expect(datesInRange("2026-07-06", "2026-07-08")).toEqual(["2026-07-06", "2026-07-07", "2026-07-08"]);
  });
  it("single day when from == to", () => {
    expect(datesInRange("2026-07-06", "2026-07-06")).toEqual(["2026-07-06"]);
  });
  it("empty when to < from or malformed", () => {
    expect(datesInRange("2026-07-08", "2026-07-06")).toEqual([]);
    expect(datesInRange("bad", "2026-07-06")).toEqual([]);
  });
  it("caps runaway ranges at 366", () => {
    expect(datesInRange("2020-01-01", "2030-01-01").length).toBe(366);
  });
});

describe("weekdayDatesInWeek", () => {
  it("maps selected weekday indices to concrete dates in a Mon-anchored week", () => {
    // Week of Mon 2026-07-06. Pick Mon(0), Wed(2), Fri(4).
    expect(weekdayDatesInWeek("2026-07-06", [0, 2, 4])).toEqual(["2026-07-06", "2026-07-08", "2026-07-10"]);
  });
  it("returns ascending regardless of input order and ignores out-of-range", () => {
    expect(weekdayDatesInWeek("2026-07-06", [6, 0, 9, -1])).toEqual(["2026-07-06", "2026-07-12"]);
  });
  it("empty for no weekdays or bad week start", () => {
    expect(weekdayDatesInWeek("2026-07-06", [])).toEqual([]);
    expect(weekdayDatesInWeek("nope", [0])).toEqual([]);
  });
});
