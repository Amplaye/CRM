import { describe, it, expect } from "vitest";
import { resolveN8nTenantHealth, normFunc, type RawWorkflow } from "./n8n-health";

// Shared engines live for every scenario unless a test overrides them.
const SHARED: RawWorkflow[] = [
  { name: "[ALL] Reminders — Multi-Tenant", active: true },
  { name: "[ALL] Follow-up Post-Cena — Multi-Tenant", active: true },
  { name: "[ALL] Waitlist Reassurance — Multi-Tenant", active: true },
  { name: "[Meta Router] WhatsApp", active: true },
];

describe("normFunc", () => {
  it("strips prefix, dashes, accents and the multi-tenant suffix", () => {
    expect(normFunc("[ALL] Follow-up Post-Cena — Multi-Tenant")).toBe("follow-up post-cena");
    expect(normFunc("[Oraz] Follow-up Post-Cena")).toBe("follow-up post-cena");
  });
  it("couples an own copy to its shared engine by function", () => {
    expect(normFunc("[Oraz] Reminders")).toBe(normFunc("[ALL] Reminders — Multi-Tenant"));
  });
});

describe("resolveN8nTenantHealth", () => {
  it("marks an off own copy as covered when a live shared engine performs it", () => {
    const all: RawWorkflow[] = [
      ...SHARED,
      { name: "[Oraz] Voice Agent Webhooks", active: true },
      { name: "[Oraz] Reminders", active: false }, // off, but [ALL] Reminders is live
    ];
    const h = resolveN8nTenantHealth("Oraz", all);
    const reminders = h.workflows.find((w) => w.func === "reminders");
    expect(reminders?.state).toBe("covered");
    expect(h.down).toBe(0);
    expect(h.ok).toBe(true);
  });

  it("does NOT cover an off own copy when the shared engine is down", () => {
    const all: RawWorkflow[] = [
      { name: "[ALL] Reminders — Multi-Tenant", active: false }, // shared engine OFF
      { name: "[Oraz] Voice Agent Webhooks", active: true },
      { name: "[Oraz] Reminders", active: false },
    ];
    const h = resolveN8nTenantHealth("Oraz", all);
    const reminders = h.workflows.find((w) => w.func === "reminders");
    // Reminders is accessory, so off+uncovered → optional, not down — but it must
    // NOT be reported as "covered" when nothing covers it.
    expect(reminders?.state).toBe("optional");
  });

  it("flags a CORE function red when off and uncovered", () => {
    const all: RawWorkflow[] = [
      ...SHARED,
      { name: "[Dental] Chatbot", active: false }, // core, uncovered → down
    ];
    const h = resolveN8nTenantHealth("Dental", all);
    expect(h.ok).toBe(false);
    expect(h.down).toBe(1);
    expect(h.workflows.find((w) => w.func === "chatbot")?.state).toBe("down");
  });

  it("treats an accessory off+uncovered workflow as optional, not a failure", () => {
    const all: RawWorkflow[] = [
      ...SHARED,
      { name: "[Picnic] Voice Agent Webhooks", active: true },
      { name: "[Picnic] Weekly AI Report", active: false }, // accessory, uncovered
      { name: "[Picnic] Nightly Conversation Audit", active: false },
    ];
    const h = resolveN8nTenantHealth("Picnic", all);
    expect(h.ok).toBe(true); // accessories don't break the tenant
    expect(h.optional).toBe(2);
    expect(h.down).toBe(0);
  });

  it("web call token is covered by the CRM endpoint without any n8n workflow", () => {
    const all: RawWorkflow[] = [
      ...SHARED,
      { name: "[Oraz] Voice Agent Webhooks", active: true },
      { name: "[Oraz] Web Call Token", active: false },
    ];
    const h = resolveN8nTenantHealth("Oraz", all);
    const wct = h.workflows.find((w) => w.func === "web call token");
    expect(wct?.state).toBe("covered");
    expect(wct?.coveredBy).toContain("CRM");
  });

  it("the Meta Router engine covers the per-tenant Chatbot WhatsApp function", () => {
    const all: RawWorkflow[] = [
      ...SHARED,
      { name: "[Oraz] Chatbot WhatsApp", active: false },
    ];
    const h = resolveN8nTenantHealth("Oraz", all);
    expect(h.workflows.find((w) => w.func === "chatbot whatsapp")?.state).toBe("covered");
  });

  it("de-dups two own copies of a function, keeping the best state", () => {
    const all: RawWorkflow[] = [
      ...SHARED,
      { name: "[Oraz] Voice Agent Webhooks", active: false }, // stale clone
      { name: "[Oraz] Voice Agent Webhooks", active: true },  // live copy
    ];
    const h = resolveN8nTenantHealth("Oraz", all);
    const matches = h.workflows.filter((w) => w.func === "voice agent webhooks");
    expect(matches).toHaveLength(1);
    expect(matches[0].state).toBe("active");
  });

  it("matches the tenant prefix exactly (BALI ≠ BALI Rest)", () => {
    const all: RawWorkflow[] = [
      ...SHARED,
      { name: "[BALI] Voice Agent Webhooks", active: true },
      { name: "[BALI Rest] Voice Agent Webhooks", active: false },
    ];
    const bali = resolveN8nTenantHealth("BALI", all);
    // Only BALI's own workflow, not BALI Rest's, counts.
    expect(bali.workflows).toHaveLength(1);
    expect(bali.workflows[0].state).toBe("active");
  });
});
