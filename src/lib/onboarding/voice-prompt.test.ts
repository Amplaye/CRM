import { describe, it, expect } from "vitest";
import { buildVoicePrompt, OpeningHours } from "./voice-prompt";

const hours: OpeningHours = {
  "0": [], // Sunday closed
  "1": [{ open: "12:30", close: "15:30" }],
  "3": [{ open: "12:30", close: "15:30" }, { open: "19:30", close: "22:30" }],
};

describe("buildVoicePrompt — fixed agency template, filled with client data", () => {
  it("embeds the restaurant name and the booking tool flow", () => {
    const p = buildVoicePrompt({ restaurant_name: "Trattoria Rossa", language: "es", opening_hours: hours });
    expect(p).toContain("Trattoria Rossa");
    expect(p).toContain("check_availability");
    expect(p).toContain("book_reservation");
  });

  it("renders a per-day schedule including closed days and multiple slots", () => {
    const p = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(p).toContain("Lun: 12:30-15:30");
    expect(p).toContain("Mié: 12:30-15:30, 19:30-22:30");
    expect(p).toContain("Dom: cerrado");
  });

  it("switches language (it) for both identity and rules", () => {
    const it = buildVoicePrompt({ restaurant_name: "Da Mario", language: "it", opening_hours: hours });
    expect(it).toContain("Sei l'agente vocale di Da Mario");
    expect(it).toContain("# Regole");
    expect(it).toContain("Dom: chiuso");
  });

  it("never invents a date header (FECHA is added later at sync time)", () => {
    const p = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(p).not.toContain("HOY");
    expect(p).not.toContain("FECHA");
  });
});
