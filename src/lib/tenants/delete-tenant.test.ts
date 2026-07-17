import { describe, it, expect, vi } from "vitest";
import { computePurgeAfter, GRACE_PERIOD_DAYS, purgeTenant, type PurgeDeps } from "./delete-tenant";

describe("computePurgeAfter", () => {
  it("adds the grace period", () => {
    const from = new Date("2026-05-22T00:00:00Z");
    const got = computePurgeAfter(from);
    const expected = new Date(from); expected.setDate(expected.getDate() + GRACE_PERIOD_DAYS);
    expect(got.toISOString()).toBe(expected.toISOString());
  });
});

/** Fake supabase that records the order of table mutations. */
function fakeSupabase(opts: { settings?: any; guests?: any[] }) {
  const calls: string[] = [];
  const tenantRow = { id: "t1", name: "Fuoricittà", status: "archived", settings: opts.settings || {} };
  const builder = (table: string) => {
    const b: any = {
      select() { return b; },
      eq() { return b; },
      neq() { return b; },
      in() { return b; },
      maybeSingle: async () => ({ data: null }),
      single: async () => (table === "tenants" ? { data: tenantRow, error: null } : { data: null, error: null }),
      delete() { calls.push(`delete:${table}`); return b; },
      then(resolve: any) {
        if (table === "guests") return resolve({ data: opts.guests || [], error: null });
        return resolve({ data: [], error: null, count: 0 });
      },
    };
    return b;
  };
  return {
    calls,
    from: (t: string) => builder(t),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "" } } }),
        deleteUser: async () => {},
        updateUserById: async () => {},
      },
    },
  } as any;
}

function stubDeps(over: Partial<PurgeDeps> = {}): PurgeDeps {
  return {
    buildExport: vi.fn(async () => ({ exported_at: "x", tenant: {} as any, reservations: [], guests: [], conversations: [], knowledge_articles: [] })),
    uploadExport: vi.fn(async () => ({ path: "t1/x.json", signedUrl: null })),
    removeSandbox: vi.fn(async () => true),
    deleteVapi: vi.fn(async () => {}),
    deleteRetell: vi.fn(async () => {}),
    ...over,
  };
}

describe("purgeTenant", () => {
  it("retells legacy tenants and deletes the tenant row LAST", async () => {
    const supabase = fakeSupabase({ settings: { retell: { agentId: "ag", llmId: "ll" }, retell_kb: { id: "kb" } } });
    const deps = stubDeps();
    const res = await purgeTenant(supabase, "t1", deps);

    expect(deps.deleteRetell).toHaveBeenCalledWith({ provider: "retell", retellAgentId: "ag", retellLlmId: "ll", retellKbId: "kb" });
    expect(deps.deleteVapi).not.toHaveBeenCalled();
    expect(deps.removeSandbox).toHaveBeenCalledWith("t1");
    expect(res.voiceProvider).toBe("retell");
    expect(res.sandboxRemoved).toBe(true);

    // orphan tables cleaned, and the tenant delete is the LAST delete recorded
    expect(supabase.calls).toEqual(
      expect.arrayContaining(["delete:bot_fixes", "delete:trello_synced_audits", "delete:webhook_events"])
    );
    expect(supabase.calls[supabase.calls.length - 1]).toBe("delete:tenants");
  });

  it("uses Vapi when assistantId is present", async () => {
    const supabase = fakeSupabase({ settings: { vapi: { assistantId: "v1" } } });
    const deps = stubDeps();
    await purgeTenant(supabase, "t1", deps);
    expect(deps.deleteVapi).toHaveBeenCalledWith("v1");
    expect(deps.deleteRetell).not.toHaveBeenCalled();
  });
});
