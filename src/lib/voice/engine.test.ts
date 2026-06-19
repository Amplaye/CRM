import { describe, it, expect } from "vitest";
import {
  greetingFor,
  buildAssistantOverrides,
  spelledDateVars,
  localeFromPhonePrefix,
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
    expect(ov.transcriber.provider).toBe("gladia");
    expect(ov.model.provider).toBe("openai");
    // Multilingual STT restricted to the 4 supported languages (no drift to
    // unrelated languages), tenant's primary first so it biases that way.
    expect(ov.transcriber.languages).toEqual(["it", "es", "en", "de"]);
    // Per-call default-language directive: the model must default to Italian,
    // not the Spanish the prompt is written in.
    expect(ov.variableValues.spoken_language).toBe("italiano");
  });

  it("puts the venue's own language first and a Spanish tenant defaults to Spanish", () => {
    const es = buildAssistantOverrides({ systemPrompt: "S", name: "BALI", locale: "es-ES" }, "t");
    expect(es.transcriber.languages).toEqual(["es", "it", "en", "de"]);
    expect(es.variableValues.spoken_language).toBe("español");
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

describe("voice engine — greeting language from caller's phone prefix", () => {
  it("maps each supported language's country codes", () => {
    expect(localeFromPhonePrefix("+390612345678")).toBe("it-IT"); // Italy
    expect(localeFromPhonePrefix("+34911223344")).toBe("es-ES"); // Spain
    expect(localeFromPhonePrefix("+447911123456")).toBe("en-GB"); // UK
    expect(localeFromPhonePrefix("+4915123456789")).toBe("de-DE"); // Germany
    expect(localeFromPhonePrefix("+12025550123")).toBe("en-GB"); // US/Canada
    expect(localeFromPhonePrefix("+5215555555555")).toBe("es-ES"); // Mexico
    expect(localeFromPhonePrefix("+41441234567")).toBe("de-DE"); // Switzerland
  });

  it("tolerates spaces, dashes and 00-international form", () => {
    expect(localeFromPhonePrefix("+44 791 112 3456")).toBe("en-GB");
    expect(localeFromPhonePrefix("0049-151-2345678")).toBe("de-DE");
    expect(localeFromPhonePrefix("(+39) 06 1234")).toBe("it-IT");
  });

  it("returns undefined for unknown prefixes, no country code, or blank", () => {
    expect(localeFromPhonePrefix("+33123456789")).toBeUndefined(); // France: not mapped
    expect(localeFromPhonePrefix("0612345678")).toBeUndefined(); // local, no country code
    expect(localeFromPhonePrefix("")).toBeUndefined();
    expect(localeFromPhonePrefix(undefined)).toBeUndefined();
  });

  it("greets + sets spoken_language from the caller's prefix, overriding the venue locale", () => {
    // Italian venue (it-IT), German caller -> greet in German.
    const ov = buildAssistantOverrides(
      { systemPrompt: "S", name: "Oraz", locale: "it-IT" },
      "t",
      {},
      undefined,
      "de-DE",
    );
    expect(ov.firstMessage).toMatch(/Hallo/);
    expect(ov.variableValues.spoken_language).toBe("Deutsch");
  });

  it("falls back to the venue locale for the greeting when no caller locale is given", () => {
    // Web call (no caller number) at an Italian venue -> Italian greeting.
    const ov = buildAssistantOverrides(
      { systemPrompt: "S", name: "Oraz", locale: "it-IT" },
      "t",
    );
    expect(ov.firstMessage).toMatch(/Ciao/);
    expect(ov.variableValues.spoken_language).toBe("italiano");
  });
});

describe("voice engine — voicemail / segreteria overrides", () => {
  it("normal/undefined state keeps the reservation greeting and adds no tools", () => {
    const ov = buildAssistantOverrides({ systemPrompt: "S", name: "BALI", locale: "es-ES" }, "t");
    expect(ov.firstMessage).toContain("Sofía"); // the regular reservation greeting
    expect(ov.model.tools).toBeUndefined();
  });

  it("active voicemail replaces the opener with the short localized one, no booking tools added", () => {
    const ov = buildAssistantOverrides(
      { systemPrompt: "S", name: "BALI", locale: "es-ES", voicemailState: "active" },
      "t",
    );
    // The voicemail opener — NOT the "soy Sofía, la asistente…" reservation greeting.
    expect(ov.firstMessage).toBe("Hola, BALI.");
    expect(ov.firstMessage).not.toContain("Sofía");
    expect(ov.model.tools).toBeUndefined();
  });

  it("forward state opens with a filler and attaches the transferCall tool to the owner", () => {
    const ov = buildAssistantOverrides(
      { systemPrompt: "S", name: "BALI", locale: "es-ES", voicemailState: "forward", forwardPhone: "+34611222333" },
      "t",
    );
    expect(ov.firstMessage).toMatch(/momento/i);
    expect(ov.model.tools).toHaveLength(1);
    expect(ov.model.tools[0].type).toBe("transferCall");
    expect(ov.model.tools[0].destinations[0].number).toBe("+34611222333");
  });

  it("greets the voicemail opener in the caller's language (German caller)", () => {
    const ov = buildAssistantOverrides(
      { systemPrompt: "S", name: "BALI", locale: "es-ES", voicemailState: "active" },
      "t",
      {},
      undefined,
      "de-DE",
    );
    expect(ov.firstMessage).toBe("Hallo, BALI.");
  });
});
