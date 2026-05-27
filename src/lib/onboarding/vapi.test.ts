import { describe, it, expect, vi, afterEach } from "vitest";
import { composeVapiSystemPrompt, isPromptArticle, findAssistantByName, repointVoiceWebhooks } from "./vapi";

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

// Recovery path for idempotent provisioning: when a truncated run already cloned
// the assistant but never recorded its id on the tenant, a retry finds it by name
// instead of leaking a second clone (the chef-oraz incident).
describe("findAssistantByName", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mockFetch = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })));

  it("returns the id of an exact name match", async () => {
    mockFetch(200, [
      { id: "a1", name: "Other — Voice", createdAt: "2026-01-01" },
      { id: "a2", name: "chef oraz — Voice", createdAt: "2026-05-23" },
    ]);
    expect(await findAssistantByName("k", "chef oraz — Voice")).toBe("a2");
  });

  it("returns null when no assistant matches the name", async () => {
    mockFetch(200, [{ id: "a1", name: "Other — Voice", createdAt: "2026-01-01" }]);
    expect(await findAssistantByName("k", "chef oraz — Voice")).toBeNull();
  });

  it("prefers the newest when duplicates share the name", async () => {
    mockFetch(200, [
      { id: "old", name: "Dup — Voice", createdAt: "2026-05-01T10:00:00Z" },
      { id: "new", name: "Dup — Voice", createdAt: "2026-05-23T19:07:00Z" },
    ]);
    expect(await findAssistantByName("k", "Dup — Voice")).toBe("new");
  });

  it("is best-effort: a failed lookup returns null and never throws", async () => {
    mockFetch(500, { error: "boom" });
    expect(await findAssistantByName("k", "whatever")).toBeNull();
  });

  it("tolerates a non-array body", async () => {
    mockFetch(200, { message: "unexpected" });
    expect(await findAssistantByName("k", "whatever")).toBeNull();
  });
});

// A clone must never inherit the template's `picnic-*` webhook URLs, or every
// new tenant's bookings land in Picnic's CRM (the oraz misrouting incident).
describe("repointVoiceWebhooks", () => {
  const base = "https://n8n.example.com/webhook";
  const template = {
    serverUrl: `${base}/picnic-post-call`,
    firstMessage: "Ciao",
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      tools: [
        { type: "function", function: { name: "check_availability" }, server: { url: `${base}/picnic-check-slots` } },
        { type: "function", function: { name: "book_table" }, server: { url: `${base}/picnic-book` } },
        { type: "function", function: { name: "get_current_date" }, server: { url: `${base}/get-current-date` } },
        { type: "endCall", function: { name: "end_call" } },
      ],
    },
  };

  it("repoints picnic-* tool URLs to the shared tenant-voice-* webhooks", () => {
    const out = repointVoiceWebhooks(template);
    const urls = out.model.tools.map((t: any) => t.server?.url);
    expect(urls).toContain(`${base}/tenant-voice-check-slots`);
    expect(urls).toContain(`${base}/tenant-voice-book`);
    expect(out.serverUrl).toBe(`${base}/tenant-voice-post-call`);
  });

  it("leaves shared/tenant-agnostic tools (get-current-date) and toolless entries untouched", () => {
    const out = repointVoiceWebhooks(template);
    const byName = (n: string) => out.model.tools.find((t: any) => t.function?.name === n);
    expect(byName("get_current_date").server.url).toBe(`${base}/get-current-date`);
    expect(byName("end_call").server).toBeUndefined();
  });

  it("does not mutate the input payload", () => {
    const snapshot = JSON.stringify(template);
    repointVoiceWebhooks(template);
    expect(JSON.stringify(template)).toBe(snapshot);
  });

  it("leaves an already-repointed payload unchanged (idempotent)", () => {
    const once = repointVoiceWebhooks(template);
    const twice = repointVoiceWebhooks(once);
    expect(twice.model.tools.map((t: any) => t.server?.url)).toEqual(
      once.model.tools.map((t: any) => t.server?.url)
    );
    expect(twice.serverUrl).toBe(once.serverUrl);
  });
});
