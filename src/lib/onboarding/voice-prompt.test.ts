import { describe, it, expect } from "vitest";
import { buildVoicePrompt, OpeningHours } from "./voice-prompt";

const hours: OpeningHours = {
  "0": [], // Sunday closed
  "1": [{ open: "12:30", close: "15:30" }],
  "3": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
};

describe("buildVoicePrompt — agency golden-source template, filled with client data", () => {
  it("embeds the restaurant name and the booking tool flow", () => {
    const p = buildVoicePrompt({ restaurant_name: "Trattoria Rossa", language: "es", opening_hours: hours });
    expect(p).toContain("Trattoria Rossa");
    expect(p).toContain("check_availability");
    expect(p).toContain("book_table");
  });

  it("carries the production behavioural rules that make the agent robust", () => {
    const p = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    // The #1 LANGUAGE rule: speak only the caller's language, never mix, and
    // never read the (now neutral, JSON) tool results aloud.
    expect(p).toContain("THREE RULES ABOVE ALL");
    // {{spoken_language}} is the OPENING language only — the agent then follows
    // the caller. Guard against a regression that re-pins it for the whole call
    // ("speak only {{spoken_language}} greeting to goodbye"), which made the model
    // bleed the opening language into the caller's on a cross-prefix call.
    expect(p).toContain("{{spoken_language}}");
    expect(p).not.toContain("greeting to goodbye");
    expect(p).toContain("switch COMPLETELY");
    expect(p).toContain("never MIX");
    expect(p).toContain("TOOL RESULTS ARE DATA");
    // The key behavioural sections must be present.
    expect(p).toContain("PHONE");
    expect(p).toContain("AFTER A RESULT");
    expect(p).toContain("LARGE GROUP (7+)");
  });

  it("uses the tenant's large-group threshold in the spoken rule (not a hardcoded 7)", () => {
    // BALI's real threshold is 13 (KB: groups 1-12 auto, 13+ pending). A hardcoded
    // 7 made the bot tell a 7-person caller "the manager will confirm" while the
    // booking route auto-confirmed — voice and CRM disagreed.
    const p13 = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours, largeGroupThreshold: 13 });
    expect(p13).toContain("LARGE GROUP (13+)");
    expect(p13).toContain("13 or more");
    expect(p13).not.toContain("LARGE GROUP (7+)");
    // Falls back to 7 when the tenant has no threshold configured.
    const pDefault = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(pDefault).toContain("LARGE GROUP (7+)");
  });

  it("renders a per-day schedule (English labels) including closed days and multiple slots", () => {
    const p = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(p).toContain("Monday: 12:30-15:30");
    expect(p).toContain("Wednesday: 12:30-15:30, 19:30-22:30");
    expect(p).toContain("Sunday: CLOSED");
  });

  it("writes the instructions in English regardless of tenant locale (runtime LANGUAGE rule + {{spoken_language}} drive the spoken language)", () => {
    const it = buildVoicePrompt({ restaurant_name: "Da Mario", language: "it", opening_hours: hours });
    expect(it).toContain("Da Mario");
    expect(it).toContain("BOOKING");
    expect(it).toContain("never MIX");
  });

  it("parametrises the backup phone in the technical-failure fallback", () => {
    const withPhone = buildVoicePrompt({
      restaurant_name: "X",
      language: "es",
      opening_hours: hours,
      restaurant_phone: "+34 641 790 137",
    });
    expect(withPhone).toContain("call you back on +34 641 790 137");

    const noPhone = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(noPhone).toContain("shall I try again?");
    expect(noPhone).not.toContain("call you back on");
  });

  it("opens with the date/time header both providers fill at call time (prevents date hallucination)", () => {
    const p = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours, timezone: "Atlantic/Canary" });
    expect(p.startsWith("TODAY {{current_date}} (ISO {{today_iso}}) · TOMORROW {{tomorrow_date}} (ISO {{tomorrow_iso}}) · NOW {{current_time}}")).toBe(true);
    expect(p).toContain("Atlantic/Canary");
    expect(p).toContain("Never invent another date");
    // The header gives ready-made ISO for today/tomorrow so the model never sends
    // a worded date to the tools, and still forbids speaking ISO/the year aloud.
    expect(p).toContain("{{today_iso}}");
    expect(p).toContain("{{tomorrow_iso}}");
    expect(p).toContain("NEVER say the ISO");
    expect(p).toContain("NEVER say the year");
  });

  it("only asks 'inside or outside?' when the venue actually has both zones", () => {
    const both = buildVoicePrompt({ restaurant_name: "X", language: "it", opening_hours: hours, zones: ["inside", "outside"] });
    expect(both).toContain('ask "inside or outside?"');

    const indoorOnly = buildVoicePrompt({ restaurant_name: "X", language: "it", opening_hours: hours, zones: ["inside"] });
    expect(indoorOnly).toContain("ONLY indoor seating");
    expect(indoorOnly).toContain("zona=inside");
    expect(indoorOnly).not.toContain('ask "inside or outside?"');

    // Unknown zones (omitted) → fall back to asking (legacy behaviour).
    const unknown = buildVoicePrompt({ restaurant_name: "X", language: "it", opening_hours: hours });
    expect(unknown).toContain('ask "inside or outside?"');
  });

  it("omits the timezone from the header when not provided", () => {
    const p = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(p.startsWith("TODAY {{current_date}} (ISO {{today_iso}}) · TOMORROW {{tomorrow_date}} (ISO {{tomorrow_iso}}) · NOW {{current_time}}\n")).toBe(true);
  });
});
