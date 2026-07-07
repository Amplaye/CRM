import { describe, it, expect } from "vitest";
import { parseInterpretation } from "./nlu";

const TODAY = "2026-07-07";

describe("parseInterpretation", () => {
  it("parses a full create_reservation action from a JSON string", () => {
    const raw = JSON.stringify({
      type: "action",
      action: {
        kind: "create_reservation",
        name: "Mario Rossi",
        phone: "+34 612 345 678",
        date: "2026-07-11",
        time: "20:30",
        party: 6,
      },
    });
    expect(parseInterpretation(raw, TODAY)).toEqual({
      type: "action",
      action: {
        kind: "create_reservation",
        name: "Mario Rossi",
        phone: "+34612345678",
        date: "2026-07-11",
        time: "20:30",
        party: 6,
      },
    });
  });

  it("strips markdown fences before parsing", () => {
    const raw = '```json\n{"type":"action","action":{"kind":"revenue"}}\n```';
    expect(parseInterpretation(raw, TODAY)).toEqual({ type: "action", action: { kind: "revenue" } });
  });

  it("keeps phone_unknown as phoneUnknown", () => {
    const out = parseInterpretation(
      { type: "action", action: { kind: "create_reservation", party: 4, phone_unknown: true } },
      TODAY,
    );
    expect(out).toMatchObject({ type: "action", phoneUnknown: true });
  });

  it("pads single-digit hours and rejects invalid times", () => {
    const ok = parseInterpretation(
      { type: "action", action: { kind: "create_reservation", time: "9:30" } },
      TODAY,
    );
    expect(ok).toMatchObject({ action: { time: "09:30" } });
    const bad = parseInterpretation(
      { type: "action", action: { kind: "create_reservation", time: "25:99" } },
      TODAY,
    );
    expect(bad).toMatchObject({ action: { kind: "create_reservation" } });
    expect((bad as { action: { time?: string } }).action.time).toBeUndefined();
  });

  it("rejects malformed dates and out-of-range party sizes", () => {
    const out = parseInterpretation(
      { type: "action", action: { kind: "create_reservation", date: "11/07/2026", party: 250 } },
      TODAY,
    );
    expect(out).toMatchObject({ action: { kind: "create_reservation" } });
    const action = (out as { action: { date?: string; party?: number } }).action;
    expect(action.date).toBeUndefined();
    expect(action.party).toBeUndefined();
  });

  it("defaults recap date to today", () => {
    const out = parseInterpretation({ type: "action", action: { kind: "recap_reservations" } }, TODAY);
    expect(out).toEqual({ type: "action", action: { kind: "recap_reservations", date: TODAY } });
  });

  it("parses open_register with a float", () => {
    const out = parseInterpretation(
      { type: "action", action: { kind: "open_register", float: 150.5 } },
      TODAY,
    );
    expect(out).toEqual({ type: "action", action: { kind: "open_register", float: 150.5 } });
  });

  it("accepts only known topic ids", () => {
    expect(parseInterpretation({ type: "topic", id: "cassa-open-close" }, TODAY)).toEqual({
      type: "topic",
      topicId: "cassa-open-close",
    });
    expect(parseInterpretation({ type: "topic", id: "made-up-topic" }, TODAY)).toBeNull();
  });

  it("parses answers, yes/no and pick", () => {
    expect(parseInterpretation({ type: "answer", text: " Certo! " }, TODAY)).toEqual({
      type: "answer",
      text: "Certo!",
    });
    expect(parseInterpretation({ type: "yes" }, TODAY)).toEqual({ type: "yes" });
    expect(parseInterpretation({ type: "no" }, TODAY)).toEqual({ type: "no" });
    expect(parseInterpretation({ type: "pick", index: 2 }, TODAY)).toEqual({ type: "pick", index: 2 });
    expect(parseInterpretation({ type: "pick", index: 0 }, TODAY)).toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parseInterpretation("not json at all", TODAY)).toBeNull();
    expect(parseInterpretation({ type: "action", action: { kind: "reboot_server" } }, TODAY)).toBeNull();
    expect(parseInterpretation({ type: "answer", text: "" }, TODAY)).toBeNull();
    expect(parseInterpretation(null, TODAY)).toBeNull();
  });
});
