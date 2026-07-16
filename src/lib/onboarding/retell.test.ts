import { describe, it, expect, vi, afterEach } from "vitest";
import { composeRetellPrompt, syncRetellPrompt } from "./retell";

const KB_BLOCK_START = "<!-- KB_BLOCK_START -->";

const voicePrompt = "HOY {{current_date}} · MAÑANA {{tomorrow_date}} · HORA {{current_time}}\n# Identidad\nAgente vocal de Trattoria Rossa.";
const kb = [
  { title: "Política de reservas", content: "Grupos 1-6 confirmación automática.", category: "policies" },
];

describe("composeRetellPrompt (shared single-source prompt)", () => {
  it("includes the voice prompt body verbatim", () => {
    const out = composeRetellPrompt(voicePrompt, []);
    expect(out).toContain("Agente vocal de Trattoria Rossa.");
    // The {{var}} date placeholders survive untouched — Retell fills them from
    // retell_llm_dynamic_variables, the same way Vapi fills variableValues.
    expect(out).toContain("{{current_date}}");
    expect(out).toContain("{{tomorrow_date}}");
  });

  it("concatenates the KB after the voice prompt, like Vapi", () => {
    const out = composeRetellPrompt(voicePrompt, kb);
    expect(out).toContain(KB_BLOCK_START);
    expect(out).toContain("[POLICIES] Política de reservas");
    // Voice prompt comes before the KB block.
    expect(out.indexOf("Agente vocal")).toBeLessThan(out.indexOf(KB_BLOCK_START));
  });
});

describe("syncRetellPrompt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not PATCH when the composed prompt already matches", async () => {
    const composed = composeRetellPrompt(voicePrompt, kb);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/get-retell-llm/")) {
        return new Response(JSON.stringify({ general_prompt: composed }), { status: 200 });
      }
      throw new Error(`unexpected call to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    const r = await syncRetellPrompt({ key: "k", llmId: "llm_1", voicePromptBody: voicePrompt, kbArticles: kb });
    expect(r.changed).toBe(false);
    // Only the GET happened — no PATCH.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PATCHes update-retell-llm with the new general_prompt when it changed", async () => {
    let patchedBody: any = null;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/get-retell-llm/")) {
        return new Response(JSON.stringify({ general_prompt: "OLD STALE PROMPT" }), { status: 200 });
      }
      if (url.includes("/update-retell-llm/")) {
        patchedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ llm_id: "llm_1" }), { status: 200 });
      }
      throw new Error(`unexpected call to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as any);
    const r = await syncRetellPrompt({ key: "k", llmId: "llm_1", voicePromptBody: voicePrompt, kbArticles: kb });
    expect(r.changed).toBe(true);
    expect(patchedBody.general_prompt).toContain("Agente vocal de Trattoria Rossa.");
    expect(patchedBody.general_prompt).toContain("{{current_date}}");
  });
});
