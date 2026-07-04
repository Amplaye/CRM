import { describe, it, expect } from "vitest";
import {
  resolveMode,
  isInsideSchedule,
  resolveVoicemailState,
  buildVoicemailBlock,
  injectBlock,
  voicemailFirstMessage,
  transferCallTool,
  VM_BLOCK_START,
  VM_BLOCK_END,
  type VoicemailConfig,
} from "./voicemail";

const baseMsg = { es: "ES_SCRIPT", en: "EN_SCRIPT", it: "IT_SCRIPT", de: "DE_SCRIPT" };

function cfg(over: Partial<VoicemailConfig> = {}): VoicemailConfig {
  return {
    enabled: false,
    mode: "off",
    schedule: { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] },
    forward_phone: "+34600111222",
    message: baseMsg,
    ...over,
  };
}

// 2026-06-01T13:00:00Z is a MONDAY; in Europe/Rome (UTC+2 in summer) that's 15:00.
const MON_15_ROME = new Date("2026-06-01T13:00:00Z");

describe("voicemail — resolveMode", () => {
  it("honours an explicit mode", () => {
    expect(resolveMode(cfg({ mode: "always" }))).toBe("always");
    expect(resolveMode(cfg({ mode: "scheduled" }))).toBe("scheduled");
    expect(resolveMode(cfg({ mode: "off" }))).toBe("off");
  });
  it("derives the mode from legacy configs without one", () => {
    expect(resolveMode(cfg({ mode: undefined, enabled: true }))).toBe("always");
    expect(resolveMode(cfg({ mode: undefined, enabled: false, schedule: { "1": [{ open: "12:00", close: "16:00" }] } }))).toBe("scheduled");
    expect(resolveMode(cfg({ mode: undefined, enabled: false }))).toBe("off");
  });
});

describe("voicemail — isInsideSchedule", () => {
  it("is true inside a Monday slot and false outside it (Rome tz)", () => {
    const inside = { "1": [{ open: "12:00", close: "16:00" }] };
    const outside = { "1": [{ open: "18:00", close: "23:00" }] };
    expect(isInsideSchedule(inside, "Europe/Rome", MON_15_ROME)).toBe(true);
    expect(isInsideSchedule(outside, "Europe/Rome", MON_15_ROME)).toBe(false);
  });
  it("supports overnight slots bleeding from the previous day", () => {
    // Sunday 22:00 -> Monday 03:00; at Monday 15:00 we're past it (false),
    // but a slot Monday 14:00->02:00 covers 15:00 (true).
    expect(isInsideSchedule({ "0": [{ open: "22:00", close: "03:00" }] }, "Europe/Rome", MON_15_ROME)).toBe(false);
    expect(isInsideSchedule({ "1": [{ open: "14:00", close: "02:00" }] }, "Europe/Rome", MON_15_ROME)).toBe(true);
  });
});

describe("voicemail — resolveVoicemailState", () => {
  it("undefined config or off mode = normal", () => {
    expect(resolveVoicemailState(undefined, "Europe/Rome", MON_15_ROME).state).toBe("normal");
    expect(resolveVoicemailState(cfg({ mode: "off" }), "Europe/Rome", MON_15_ROME).state).toBe("normal");
  });
  it("always mode = active regardless of time", () => {
    const r = resolveVoicemailState(cfg({ mode: "always" }), "Europe/Rome", MON_15_ROME);
    expect(r.state).toBe("active");
    expect(r.active).toBe(true);
  });
  it("scheduled = active inside the slot, forward outside it", () => {
    const inSlot = cfg({ mode: "scheduled", schedule: { "1": [{ open: "12:00", close: "16:00" }] } });
    const outSlot = cfg({ mode: "scheduled", schedule: { "1": [{ open: "18:00", close: "23:00" }] } });
    expect(resolveVoicemailState(inSlot, "Europe/Rome", MON_15_ROME).state).toBe("active");
    const fwd = resolveVoicemailState(outSlot, "Europe/Rome", MON_15_ROME);
    expect(fwd.state).toBe("forward");
    expect(fwd.forwardPhone).toBe("+34600111222");
  });
});

describe("voicemail — buildVoicemailBlock", () => {
  it("ACTIVE block forbids bookings and carries all four scripts", () => {
    const b = buildVoicemailBlock(true, cfg({ mode: "always" }));
    expect(b).toContain("VOICEMAIL ACTIVE");
    expect(b).toContain("do NOT take reservations");
    expect(b).toContain("ES_SCRIPT");
    expect(b).toContain("IT_SCRIPT");
    expect(b).toContain(VM_BLOCK_START);
    expect(b).toContain(VM_BLOCK_END);
  });
  it("FORWARD block (scheduled + inactive) names the transfer + phone", () => {
    const b = buildVoicemailBlock(false, cfg({ mode: "scheduled" }));
    expect(b).toContain("FORWARD ACTIVE");
    expect(b).toContain("transferCall");
    expect(b).toContain("+34600111222");
  });
  it("NORMAL block (off + inactive) stands down", () => {
    const b = buildVoicemailBlock(false, cfg({ mode: "off" }));
    expect(b).toContain("NORMAL");
    expect(b).toContain("This block is INACTIVE");
  });
});

describe("voicemail — injectBlock", () => {
  it("prepends the block on first install (precedence over the rest)", () => {
    const out = injectBlock("ORIGINAL PROMPT", "BLOCK");
    expect(out.startsWith("BLOCK")).toBe(true);
    expect(out).toContain("ORIGINAL PROMPT");
  });
  it("replaces an existing block in place instead of stacking", () => {
    const first = injectBlock("PROMPT", buildVoicemailBlock(true, cfg({ mode: "always" })));
    const second = injectBlock(first, buildVoicemailBlock(false, cfg({ mode: "off" })));
    // Only one block remains.
    expect(second.split(VM_BLOCK_START).length - 1).toBe(1);
    expect(second).toContain("NORMAL");
    expect(second).not.toContain("VOICEMAIL ACTIVE");
  });
});

describe("voicemail — firstMessage + transfer tool", () => {
  it("active speaks the FULL script when provided, else a bare greeting; normal = null", () => {
    const script = {
      es: "Hola, has llamado a BALI. Te hemos enviado un WhatsApp.",
      it: "Ciao, hai chiamato BALI. Ti abbiamo inviato un WhatsApp.",
      en: "Hi, you called BALI. We've sent you a WhatsApp.",
      de: "Hallo, du hast BALI angerufen. Wir haben dir eine WhatsApp geschickt.",
    };
    // Active speaks the full script (deterministic delivery, not model-dependent),
    // closed by the endCallPhrases goodbye so Vapi hangs up by itself (d55f588).
    expect(voicemailFirstMessage("active", "BALI", "es", script)).toBe(`${script.es} Adiós.`);
    expect(voicemailFirstMessage("active", "BALI", "it", script)).toBe(`${script.it} Arrivederci.`);
    // No script → falls back to a bare localized greeting.
    expect(voicemailFirstMessage("active", "BALI", "es")).toBe("Hola, BALI. Adiós.");
    expect(voicemailFirstMessage("forward", "BALI", "it")).toMatch(/attimo/i);
    expect(voicemailFirstMessage("normal", "BALI", "es")).toBeNull();
  });
  it("transferCallTool points at the given phone", () => {
    const t = transferCallTool("+34999000111") as any;
    expect(t.type).toBe("transferCall");
    expect(t.destinations[0].number).toBe("+34999000111");
  });
});
