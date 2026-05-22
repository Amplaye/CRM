import { describe, it, expect } from "vitest";
import {
  n8nWorkflowIdsToRemove,
  voiceTeardownPlan,
  classifyStaffForTeardown,
  botSessionPhonesToClean,
} from "./teardown";

describe("n8nWorkflowIdsToRemove", () => {
  const all = [
    { id: "a", name: "[Fuoricittà] Reminders" },
    { id: "b", name: "[Fuoricittà] Chatbot WhatsApp" },
    { id: "c", name: "[Picnic] Reminders" },
    { id: "d", name: "Some other flow" },
  ];
  it("matches by name prefix", () => {
    expect(n8nWorkflowIdsToRemove(all, "Fuoricittà").sort()).toEqual(["a", "b"]);
  });
  it("never matches another tenant or unrelated flows", () => {
    const got = n8nWorkflowIdsToRemove(all, "Fuoricittà");
    expect(got).not.toContain("c");
    expect(got).not.toContain("d");
  });
  it("unions stored ids with name matches, de-duped", () => {
    expect(n8nWorkflowIdsToRemove(all, "Fuoricittà", ["a", "z"]).sort()).toEqual(["a", "b", "z"]);
  });
});

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
