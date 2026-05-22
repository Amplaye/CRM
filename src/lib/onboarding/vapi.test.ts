import { describe, it, expect } from "vitest";
import { composeVapiSystemPrompt, isPromptArticle } from "./vapi";

const VM_BLOCK_START = "<!-- VOICEMAIL_BLOCK_START -->";
const VM_BLOCK_END = "<!-- VOICEMAIL_BLOCK_END -->";
const KB_BLOCK_START = "<!-- KB_BLOCK_START -->";
const KB_BLOCK_END = "<!-- KB_BLOCK_END -->";

const vmBlock = `${VM_BLOCK_START}\nDYNAMIC VOICEMAIL CONTROL\nForward to +34600000000\n${VM_BLOCK_END}`;

const voicePrompt = "# Identidad\nEres el agente vocal de Trattoria Rossa.";

const kb = [
  { title: "Política de reservas", content: "Grupos 1-6 confirmación automática.", category: "policies" },
  { title: "Ubicación", content: "Calle Mayor 12.", category: "general" },
];

describe("isPromptArticle", () => {
  it("matches every case/punctuation variant of VOICE PROMPT", () => {
    for (const t of ["VOICE PROMPT", "voice-prompt", "voicePrompt", "_VOICE_PROMPT_", "Voice Prompt"]) {
      expect(isPromptArticle(t)).toBe(true);
    }
  });
  it("does not match real KB titles", () => {
    for (const t of ["Política de reservas", "Voice", "Prompt", "Horario del restaurante", ""]) {
      expect(isPromptArticle(t)).toBe(false);
    }
  });
});

describe("composeVapiSystemPrompt", () => {
  it("includes the voice prompt body", () => {
    const out = composeVapiSystemPrompt({ voicePromptBody: voicePrompt, kbArticles: [] });
    expect(out).toContain("Eres el agente vocal de Trattoria Rossa.");
  });

  it("includes the KB articles inside a delimited block", () => {
    const out = composeVapiSystemPrompt({ voicePromptBody: voicePrompt, kbArticles: kb });
    expect(out).toContain(KB_BLOCK_START);
    expect(out).toContain(KB_BLOCK_END);
    expect(out).toContain("[POLICIES] Política de reservas");
    expect(out).toContain("Grupos 1-6 confirmación automática.");
    expect(out).toContain("[GENERAL] Ubicación");
  });

  it("preserves an existing voicemail block and keeps it before the voice prompt", () => {
    const existing = `${vmBlock}\n\nold voice prompt\n\n${KB_BLOCK_START}\nold kb\n${KB_BLOCK_END}`;
    const out = composeVapiSystemPrompt({ voicePromptBody: voicePrompt, kbArticles: kb, existingPrompt: existing });
    // VM block carried over verbatim...
    expect(out).toContain(vmBlock);
    // ...and positioned before the (new) voice prompt.
    expect(out.indexOf(VM_BLOCK_START)).toBeLessThan(out.indexOf("Eres el agente vocal"));
    // The stale voice prompt + KB are replaced, not duplicated.
    expect(out).not.toContain("old voice prompt");
    expect(out).not.toContain("old kb");
  });

  it("does not invent a voicemail block when none exists", () => {
    const out = composeVapiSystemPrompt({ voicePromptBody: voicePrompt, kbArticles: kb });
    expect(out).not.toContain(VM_BLOCK_START);
  });

  it("omits the KB block entirely when there are no published articles", () => {
    const out = composeVapiSystemPrompt({ voicePromptBody: voicePrompt, kbArticles: [] });
    expect(out).not.toContain(KB_BLOCK_START);
    expect(out.trim()).toBe(voicePrompt);
  });

  it("skips empty/blank articles", () => {
    const out = composeVapiSystemPrompt({
      voicePromptBody: voicePrompt,
      kbArticles: [{ title: "Empty", content: "   ", category: "general" }, { title: "", content: "x", category: "general" }],
    });
    expect(out).not.toContain(KB_BLOCK_START);
  });

  it("is idempotent: re-composing its own output preserves the VM block and adds nothing", () => {
    const first = composeVapiSystemPrompt({ voicePromptBody: voicePrompt, kbArticles: kb, existingPrompt: vmBlock });
    const second = composeVapiSystemPrompt({ voicePromptBody: voicePrompt, kbArticles: kb, existingPrompt: first });
    expect(second).toBe(first);
  });
});
