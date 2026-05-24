import { describe, it, expect } from "vitest";
import { activationFromSettings, N8N_TEMPLATE_COUNT } from "./activation";

/** A settings blob for a fully, correctly provisioned tenant. */
const fullSettings = {
  onboarding: { completed: true },
  vapi: { assistantId: "asst_abc" },
  n8n: { workflow_ids: Array.from({ length: N8N_TEMPLATE_COUNT }, (_, i) => `wf_${i}`) },
};

describe("activationFromSettings", () => {
  it("a fully provisioned active tenant is ok and not incomplete", () => {
    const v = activationFromSettings("active", fullSettings as any);
    expect(v.state).toBe("ok");
    expect(v.incomplete).toBe(false);
    expect(v.reasons).toEqual([]);
  });

  it("the PICNIC/chef-oraz incident: marker missing + 0 workflows + trial = incomplete", () => {
    // The exact shape that showed "Healthy" in the list but "INCOMPLETA" in the card.
    const v = activationFromSettings("trial", {
      vapi: { assistantId: "asst_abc" }, // Vapi was connected
      // no onboarding.completed, no n8n.workflow_ids
    } as any);
    expect(v.incomplete).toBe(true);
    expect(v.state).toBe("fail");
    expect(v.reasons).toContain("onboarding incompleto (marker mancante)");
    expect(v.reasons).toContain("automazioni non create");
  });

  it("missing onboarding marker alone fails", () => {
    const v = activationFromSettings("active", { ...fullSettings, onboarding: {} } as any);
    expect(v.incomplete).toBe(true);
  });

  it("partial n8n workflows fail with a count reason", () => {
    const v = activationFromSettings("active", {
      ...fullSettings,
      n8n: { workflow_ids: ["wf_1", "wf_2"] },
    } as any);
    expect(v.incomplete).toBe(true);
    expect(v.reasons.some((r) => r.includes(`2/${N8N_TEMPLATE_COUNT}`))).toBe(true);
  });

  it("a Retell (legacy) voice assistant counts as a voice assistant", () => {
    const v = activationFromSettings("active", {
      onboarding: { completed: true },
      retell: { agentId: "agent_x" },
      n8n: { workflow_ids: Array.from({ length: N8N_TEMPLATE_COUNT }, (_, i) => `wf_${i}`) },
    } as any);
    expect(v.reasons).not.toContain("nessun assistente vocale collegato");
    expect(v.incomplete).toBe(false);
  });

  it("no voice assistant of either kind fails", () => {
    const { vapi, ...noVoice } = fullSettings;
    const v = activationFromSettings("active", noVoice as any);
    expect(v.incomplete).toBe(true);
    expect(v.reasons).toContain("nessun assistente vocale collegato");
  });

  it("trial status on an otherwise complete tenant is a warning, not incomplete", () => {
    const v = activationFromSettings("trial", fullSettings as any);
    expect(v.state).toBe("warn");
    expect(v.incomplete).toBe(false);
    expect(v.reasons).toContain("stato trial — provisioning non concluso");
  });

  it("suspended status fails even when provisioning artifacts exist", () => {
    const v = activationFromSettings("suspended", fullSettings as any);
    expect(v.state).toBe("fail");
    expect(v.incomplete).toBe(true);
    expect(v.reasons).toContain("stato suspended");
  });

  it("null settings is treated as fully incomplete (never provisioned)", () => {
    const v = activationFromSettings("pending", null);
    expect(v.incomplete).toBe(true);
  });

  it("WhatsApp number is not a marker — sandbox tenant can still be ok", () => {
    // No whatsapp.from anywhere, but everything else complete → still ok.
    const v = activationFromSettings("active", fullSettings as any);
    expect(v.incomplete).toBe(false);
  });
});
