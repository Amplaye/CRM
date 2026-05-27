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
    // The rule that fixes the oraz language-mixing bug.
    expect(p).toContain("PROHIBIDO mezclar idiomas");
    expect(p).toContain("IDIOMAS (ES/IT/EN/DE)");
    // A few other golden-source sections must be present.
    expect(p).toContain("TELÉFONO (CRÍTICO)");
    expect(p).toContain("ANTI-ECO");
    expect(p).toContain("CIERRE");
  });

  it("renders a per-day schedule (in Spanish) including closed days and multiple slots", () => {
    const p = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(p).toContain("Lunes: 12:30-15:30");
    expect(p).toContain("Miércoles: 12:30-15:30, 19:30-22:30");
    expect(p).toContain("Domingo: CERRADO");
  });

  it("writes the instructions in Spanish regardless of the tenant locale (runtime IDIOMAS rule handles spoken language)", () => {
    const it = buildVoicePrompt({ restaurant_name: "Da Mario", language: "it", opening_hours: hours });
    // Spanish working language, tenant name still embedded.
    expect(it).toContain("Da Mario");
    expect(it).toContain("ESTILO");
    expect(it).toContain("PROHIBIDO mezclar idiomas");
  });

  it("parametrises the backup phone in the technical-failure fallback", () => {
    const withPhone = buildVoicePrompt({
      restaurant_name: "X",
      language: "es",
      opening_hours: hours,
      restaurant_phone: "+34 641 790 137",
    });
    expect(withPhone).toContain("¿llamamos al +34 641 790 137 o lo intento de nuevo?");

    const noPhone = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(noPhone).toContain("Problema técnico, ¿lo intento de nuevo?");
    expect(noPhone).not.toContain("llamamos al");
  });

  it("never invents a date header (FECHA is added later at sync time)", () => {
    const p = buildVoicePrompt({ restaurant_name: "X", language: "es", opening_hours: hours });
    expect(p).not.toContain("HOY {{");
    expect(p).not.toContain("{{current_date}}");
  });
});
