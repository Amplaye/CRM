import { describe, it, expect } from "vitest";
import { resolveVoiceSwitch, applyVoiceProvider } from "./voice-provider";

describe("resolveVoiceSwitch", () => {
  it("is a no-op when already on the target tier", () => {
    const p = resolveVoiceSwitch({ voice: { provider: "vapi" }, vapi: { assistantId: "a" } }, "vapi");
    expect(p.noop).toBe(true);
    expect(p.from).toBe("vapi");
  });

  it("promote base→premium reuses a kept Retell agent (no re-provision)", () => {
    const p = resolveVoiceSwitch(
      { voice: { provider: "vapi" }, vapi: { assistantId: "a" }, retell: { agentId: "agent_x" } },
      "retell",
    );
    expect(p.noop).toBe(false);
    expect(p.to).toBe("retell");
    expect(p.needsProvision).toBe(false);
    expect(p.existingTargetId).toBe("agent_x");
  });

  it("promote base→premium with no Retell agent yet needs provisioning", () => {
    const p = resolveVoiceSwitch({ voice: { provider: "vapi" }, vapi: { assistantId: "a" } }, "retell");
    expect(p.needsProvision).toBe(true);
    expect(p.existingTargetId).toBeUndefined();
  });

  it("demote premium→base reuses the kept Vapi clone", () => {
    const p = resolveVoiceSwitch(
      { voice: { provider: "retell" }, vapi: { assistantId: "asst_x" }, retell: { agentId: "agent_x" } },
      "vapi",
    );
    expect(p.from).toBe("retell");
    expect(p.to).toBe("vapi");
    expect(p.needsProvision).toBe(false);
    expect(p.existingTargetId).toBe("asst_x");
  });
});

describe("applyVoiceProvider", () => {
  it("flips the flag while keeping both provider ids intact (reversible)", () => {
    const next = applyVoiceProvider(
      { vapi: { assistantId: "a" }, retell: { agentId: "r" }, locale: "es-ES" },
      "retell",
    );
    expect(next.voice?.provider).toBe("retell");
    expect(next.vapi?.assistantId).toBe("a"); // kept for instant downgrade
    expect(next.retell?.agentId).toBe("r");
    expect(next.locale).toBe("es-ES");
  });

  it("does not mutate the input", () => {
    const input = { voice: { provider: "vapi" as const } };
    applyVoiceProvider(input, "retell");
    expect(input.voice.provider).toBe("vapi");
  });
});
