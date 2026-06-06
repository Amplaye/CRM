import { describe, it, expect } from "vitest";
import {
  greetingFor,
  transcriberKeywords,
  buildAssistantOverrides,
  spelledDateVars,
  ENGINE_VAPI_ASSISTANT_ID,
} from "./engine";

describe("voice engine — pure helpers", () => {
  it("greets in the tenant's primary language, introducing herself by name + venue", () => {
    // "Ciao, sono Sofía, l'assistente di Oraz. Come posso aiutarti?"
    expect(greetingFor("Oraz", "it-IT")).toContain("Oraz");
    expect(greetingFor("Oraz", "it-IT")).toContain("Sofía");
    expect(greetingFor("Oraz", "it-IT")).toMatch(/Ciao/);
    expect(greetingFor("Picnic", "es-ES")).toMatch(/Hola/);
    expect(greetingFor("X", "en-GB")).toMatch(/Hi/);
    expect(greetingFor("X", "de-DE")).toMatch(/Hallo/);
    expect(greetingFor("X")).toMatch(/Hola/); // default es
    // assistant always names herself
    expect(greetingFor("X", "es-ES")).toContain("Sofía");
  });

  it("includes the venue name tokens in the transcriber keywords, localized", () => {
    const kw = transcriberKeywords("BALI Rest"); // default es
    expect(kw).toContain("BALI");
    expect(kw).toContain("Rest");
    expect(kw).toContain("reserva");
    expect(new Set(kw).size).toBe(kw.length); // de-duplicated
    // Italian tenants get Italian hints — Spanish hints would bias the STT to ES.
    const it = transcriberKeywords("Oraz", "it");
    expect(it).toContain("prenotazione");
    expect(it).not.toContain("reserva");
  });

  it("stamps metadata.tenant_id and the system prompt into the overrides", () => {
    const ov = buildAssistantOverrides(
      { systemPrompt: "SYS", name: "Oraz", locale: "it-IT" },
      "tenant-123",
      { current_date: "lunedì 1 giugno 2026", current_time: "11:15" },
    );
    expect(ov.metadata.tenant_id).toBe("tenant-123");
    expect(ov.model.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(ov.variableValues.current_date).toBe("lunedì 1 giugno 2026");
    expect(ov.firstMessage).toContain("Oraz");
    // Vapi rejects (400) transcriber/model overrides that omit `provider`.
    expect(ov.transcriber.provider).toBe("deepgram");
    expect(ov.model.provider).toBe("openai");
    // Language MUST be pinned to the tenant's locale, else Deepgram auto-detects
    // and mis-hears Italian as Spanish — making the model reply in Spanish.
    expect(ov.transcriber.language).toBe("it");
    expect(ov.transcriber.keywords).toContain("prenotazione");
  });

  it("spells the date in full in the tenant's tz + language", () => {
    // 2026-06-01 is a Monday.
    const vars = spelledDateVars(new Date("2026-06-01T10:15:00Z"), "Europe/Rome", "it-IT");
    expect(vars.current_date).toMatch(/lunedì/);
    expect(vars.current_date).toMatch(/2026/);
    expect(vars.tomorrow_date).toMatch(/marted/); // martedì
    expect(vars.current_time).toMatch(/^\d{2}:\d{2}$/);
    // never ISO
    expect(vars.current_date).not.toMatch(/2026-06-01/);
  });

  it("exposes a non-empty engine assistant id", () => {
    expect(ENGINE_VAPI_ASSISTANT_ID).toMatch(/[0-9a-f-]{36}/);
  });
});
