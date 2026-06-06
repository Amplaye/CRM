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

  it("keyterm is just the venue name tokens (language-neutral for multilingual STT)", () => {
    const kw = transcriberKeywords("BALI Rest");
    expect(kw).toContain("BALI");
    expect(kw).toContain("Rest");
    expect(new Set(kw).size).toBe(kw.length); // de-duplicated
    // No language-specific domain words — they would bias code-switching.
    expect(kw).not.toContain("reserva");
    expect(kw).not.toContain("prenotazione");
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
    // Multilingual STT (not pinned to one language) so the agent adapts to the
    // caller; nova-3; venue name in keyterm.
    expect(ov.transcriber.language).toBe("multi");
    expect(ov.transcriber.model).toBe("nova-3");
    expect(ov.transcriber.keyterm).toContain("Oraz");
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
