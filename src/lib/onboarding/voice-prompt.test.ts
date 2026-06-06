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
    // never read the Spanish tool results aloud.
    expect(p).toContain("LANGUAGE — THE #1 RULE");
    expect(p).toContain("{{spoken_language}}");
    expect(p).toContain("TOOL RESULTS ARE DATA, NOT A SCRIPT");
    // The key behavioural sections must be present.
    expect(p).toContain("PHONE");
    expect(p).toContain("CLOSING");
    expect(p).toContain("LARGE GROUPS (7+)");
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
    expect(it).toContain("BOOKING FLOW");
    expect(it).toContain("Never mix two languages");
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
    expect(p.startsWith("TODAY {{current_date}} · TOMORROW {{tomorrow_date}} · NOW {{current_time}}")).toBe(true);
    expect(p).toContain("Atlantic/Canary");
    expect(p).toContain("NEVER invent another date");
    // The header tells the agent never to speak ISO, and never to speak the year.
    expect(p).toContain("FORBIDDEN to speak ISO aloud");
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
    expect(p.startsWith("TODAY {{current_date}} · TOMORROW {{tomorrow_date}} · NOW {{current_time}}\n")).toBe(true);
  });
});
