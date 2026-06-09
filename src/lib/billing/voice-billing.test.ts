import { describe, it, expect } from "vitest";
import type { TenantSettings } from "@/lib/types/tenant-settings";
import {
  voiceProviderFromAddons,
  planVoiceBillingSync,
  syncVoiceProviderFromBilling,
} from "./voice-billing";

describe("voiceProviderFromAddons — the provider IS the SKU", () => {
  it("voice_vapi grants the base (Vapi) tier", () => {
    expect(voiceProviderFromAddons(["voice_vapi"])).toBe("vapi");
  });
  it("voice_retell grants the premium (Retell) tier", () => {
    expect(voiceProviderFromAddons(["voice_retell"])).toBe("retell");
  });
  it("premium wins if both are somehow owned (never silently downgrade a payer)", () => {
    expect(voiceProviderFromAddons(["voice_vapi", "voice_retell"])).toBe("retell");
  });
  it("legacy voice_agent maps to premium so old subscriptions keep Retell", () => {
    expect(voiceProviderFromAddons(["voice_agent"])).toBe("retell");
  });
  it("a non-voice add-on grants no voice tier", () => {
    expect(voiceProviderFromAddons(["website_design"])).toBeNull();
  });
  it("empty / nullish → no tier", () => {
    expect(voiceProviderFromAddons([])).toBeNull();
    expect(voiceProviderFromAddons(null)).toBeNull();
    expect(voiceProviderFromAddons(undefined)).toBeNull();
  });
});

describe("planVoiceBillingSync — flip the tier the add-ons paid for", () => {
  it("no voice add-on → no-op, never touches voice.provider", () => {
    const plan = planVoiceBillingSync({ voice: { provider: "vapi" } }, ["website_design"]);
    expect(plan.noop).toBe(true);
    expect(plan.target).toBeNull();
    expect(plan.nextSettings).toBeNull();
  });

  it("buying base with no agent yet → flips to vapi, provisioning pending", () => {
    const plan = planVoiceBillingSync({}, ["voice_vapi"]);
    expect(plan.noop).toBe(false);
    expect(plan.target).toBe("vapi");
    expect(plan.provisioning).toBe("pending");
    expect(plan.nextSettings?.voice).toEqual({ provider: "vapi", provisioning: "pending" });
  });

  it("upgrade base→premium reusing a kept Retell agent → active, prompt untouched", () => {
    const settings: TenantSettings = {
      voice: { provider: "vapi" },
      vapi: { assistantId: "asst_x" },
      retell: { agentId: "agent_x" },
    };
    const plan = planVoiceBillingSync(settings, ["voice_retell"]);
    expect(plan.noop).toBe(false);
    expect(plan.target).toBe("retell");
    expect(plan.provisioning).toBe("active");
    expect(plan.nextSettings?.voice?.provider).toBe("retell");
    // The other provider's id is preserved so a downgrade is instant.
    expect(plan.nextSettings?.vapi?.assistantId).toBe("asst_x");
    expect(plan.nextSettings?.retell?.agentId).toBe("agent_x");
  });

  it("upgrade base→premium with no Retell agent → pending (provision out-of-band)", () => {
    const plan = planVoiceBillingSync({ voice: { provider: "vapi" }, vapi: { assistantId: "a" } }, [
      "voice_retell",
    ]);
    expect(plan.target).toBe("retell");
    expect(plan.provisioning).toBe("pending");
  });

  it("is idempotent — already on the entitled tier + provisioning recorded → no-op", () => {
    const settings: TenantSettings = {
      voice: { provider: "retell", provisioning: "active" },
      retell: { agentId: "agent_x" },
    };
    const plan = planVoiceBillingSync(settings, ["voice_retell"]);
    expect(plan.noop).toBe(true);
    expect(plan.nextSettings).toBeNull();
  });

  it("re-writes when the tier matches but the provisioning state was never recorded", () => {
    // legacy tenant already on retell (deduced) but no provisioning flag yet.
    const settings: TenantSettings = { voice: { provider: "retell" }, retell: { agentId: "agent_x" } };
    const plan = planVoiceBillingSync(settings, ["voice_retell"]);
    expect(plan.noop).toBe(false);
    expect(plan.nextSettings?.voice?.provisioning).toBe("active");
  });
});

describe("syncVoiceProviderFromBilling — persists only when there's a change", () => {
  function fakeSvc(settings: TenantSettings) {
    const updates: Array<Record<string, unknown>> = [];
    const svc = {
      from(_table: string) {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: { settings } }) };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return { eq: async () => ({ data: null }) };
          },
        };
      },
    };
    return { svc, updates };
  }

  it("writes the flipped settings when buying a voice add-on", async () => {
    const { svc, updates } = fakeSvc({});
    const plan = await syncVoiceProviderFromBilling(svc, "t1", ["voice_retell"]);
    expect(plan.noop).toBe(false);
    expect(updates).toHaveLength(1);
    const next = (updates[0].settings as TenantSettings).voice;
    expect(next).toEqual({ provider: "retell", provisioning: "pending" });
  });

  it("does not write when there's no voice add-on", async () => {
    const { svc, updates } = fakeSvc({ voice: { provider: "vapi" } });
    const plan = await syncVoiceProviderFromBilling(svc, "t1", ["website_design"]);
    expect(plan.noop).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it("does not write when already on the entitled tier (idempotent)", async () => {
    const { svc, updates } = fakeSvc({
      voice: { provider: "vapi", provisioning: "pending" },
    });
    const plan = await syncVoiceProviderFromBilling(svc, "t1", ["voice_vapi"]);
    expect(plan.noop).toBe(true);
    expect(updates).toHaveLength(0);
  });
});
