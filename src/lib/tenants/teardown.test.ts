import { describe, it, expect } from "vitest";
import {
  voiceTeardownPlan,
  classifyStaffForTeardown,
  botSessionPhonesToClean,
} from "./teardown";
import { TEMPLATE_VAPI_ASSISTANT_ID } from "@/lib/onboarding/vapi";

describe("voiceTeardownPlan", () => {
  it("prefers vapi when assistantId present", () => {
    expect(voiceTeardownPlan({ vapi: { assistantId: "v1" } })).toEqual({ provider: "vapi", vapiAssistantId: "v1" });
  });
  it("falls back to retell agent + llm + kb", () => {
    expect(
      voiceTeardownPlan({ retell: { agentId: "ag", llmId: "ll" }, retell_kb: { id: "kb" } })
    ).toEqual({ provider: "retell", retellAgentId: "ag", retellLlmId: "ll", retellKbId: "kb" });
  });
  it("returns none when no voice config", () => {
    expect(voiceTeardownPlan({}).provider).toBe("none");
    expect(voiceTeardownPlan(null).provider).toBe("none");
  });
  it("NEVER plans to delete the shared golden template (PICNIC carries its id)", () => {
    // PICNIC's settings.vapi points at the template every tenant is cloned from;
    // tearing it down must not wipe the template.
    expect(voiceTeardownPlan({ vapi: { assistantId: TEMPLATE_VAPI_ASSISTANT_ID } }).provider).toBe("none");
  });
  it("still tears down a real clone whose id is not the template", () => {
    expect(voiceTeardownPlan({ vapi: { assistantId: "9a1174e4-real-clone" } })).toEqual({
      provider: "vapi",
      vapiAssistantId: "9a1174e4-real-clone",
    });
  });
});

describe("classifyStaffForTeardown", () => {
  it("never touches platform_admins or multi-tenant users", () => {
    const plan = classifyStaffForTeardown([
      { user_id: "admin", email: "a@x.com", global_role: "platform_admin", otherTenantCount: 0 },
      { user_id: "multi", email: "m@x.com", global_role: "user", otherTenantCount: 2 },
    ]);
    expect(plan.skip.sort()).toEqual(["admin", "multi"]);
    expect(plan.delete).toEqual([]);
    expect(plan.ban).toEqual([]);
  });
  it("deletes both QR-staff and real single-tenant staff (frees their email)", () => {
    const plan = classifyStaffForTeardown([
      { user_id: "qr", email: "x@baliflow.local", global_role: "user", otherTenantCount: 0 },
      { user_id: "real", email: "joe@gmail.com", global_role: "user", otherTenantCount: 0 },
    ]);
    expect(plan.delete.sort()).toEqual(["qr", "real"]);
    expect(plan.ban).toEqual([]);
  });
  it("de-dupes repeated user_ids", () => {
    const plan = classifyStaffForTeardown([
      { user_id: "qr", email: "x@baliflow.local", global_role: "user", otherTenantCount: 0 },
      { user_id: "qr", email: "x@baliflow.local", global_role: "user", otherTenantCount: 0 },
    ]);
    expect(plan.delete).toEqual(["qr"]);
  });
});

describe("botSessionPhonesToClean", () => {
  it("keeps only phones not used by other tenants", () => {
    expect(botSessionPhonesToClean(["+1", "+2", "+3"], ["+2"]).sort()).toEqual(["+1", "+3"]);
  });
  it("de-dupes and drops empties", () => {
    expect(botSessionPhonesToClean(["+1", "+1", ""], []).sort()).toEqual(["+1"]);
  });
});
