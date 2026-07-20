import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny fake of the PostgREST builder: every filter call records itself and
// returns `this`, so a test can assert exactly which filters a query applied.
function makeFakeSupabase(existingRows: any[] = []) {
  const calls: { table: string; filters: Record<string, any>; op: string }[] = [];
  const inserted: any[] = [];
  const updated: any[] = [];

  const from = (table: string) => {
    const filters: Record<string, any> = {};
    let op = "select";
    const builder: any = {
      select: () => {
        op = "select";
        calls.push({ table, filters, op });
        return builder;
      },
      eq: (col: string, val: any) => {
        filters[col] = val;
        return builder;
      },
      is: (col: string, val: any) => {
        filters[col] = val;
        return builder;
      },
      contains: (col: string, val: any) => {
        filters[`contains:${col}`] = val;
        return builder;
      },
      order: () => builder,
      limit: () => Promise.resolve({ data: existingRows, error: null }),
      insert: (row: any) => {
        inserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      update: (patch: any) => {
        updated.push({ patch, filters });
        return builder;
      },
    };
    return builder;
  };

  return { client: { from }, calls, inserted, updated };
}

const state: { fake: ReturnType<typeof makeFakeSupabase> } = {
  fake: makeFakeSupabase(),
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => state.fake.client,
}));

// Imported after the mock so the module picks up the fake client.
const { logSystemEvent } = await import("./system-log");

describe("logSystemEvent dedup scoping", () => {
  beforeEach(() => {
    state.fake = makeFakeSupabase();
  });

  it("scopes the dedup lookup to the tenant that raised the error", async () => {
    await logSystemEvent({
      tenant_id: "tenant-a",
      category: "api_error",
      severity: "high",
      title: "POS sync failed",
      error_key: "pos_sync_failed",
    });

    const lookup = state.fake.calls.find((c) => c.table === "system_logs");
    expect(lookup?.filters.tenant_id).toBe("tenant-a");
    expect(lookup?.filters["contains:metadata"]).toEqual({
      error_key: "pos_sync_failed",
    });
  });

  it("does not fold one tenant's error into another tenant's open row", async () => {
    // An open row exists, but it belongs to a different tenant. Because the
    // lookup is tenant-scoped it must not be returned, so the second tenant
    // gets its own row rather than silently bumping the first tenant's count.
    state.fake = makeFakeSupabase([]);

    await logSystemEvent({
      tenant_id: "tenant-b",
      category: "api_error",
      severity: "high",
      title: "POS sync failed",
      error_key: "pos_sync_failed",
    });

    expect(state.fake.updated).toHaveLength(0);
    expect(state.fake.inserted).toHaveLength(1);
    expect(state.fake.inserted[0].tenant_id).toBe("tenant-b");
  });

  it("increments the existing row when the same tenant re-raises the error", async () => {
    state.fake = makeFakeSupabase([
      { id: "log-1", metadata: { error_key: "pos_sync_failed", occurrence_count: 2 } },
    ]);

    await logSystemEvent({
      tenant_id: "tenant-a",
      category: "api_error",
      severity: "high",
      title: "POS sync failed",
      error_key: "pos_sync_failed",
    });

    expect(state.fake.inserted).toHaveLength(0);
    expect(state.fake.updated).toHaveLength(1);
    expect(state.fake.updated[0].patch.metadata.occurrence_count).toBe(3);
  });

  it("scopes platform-level events (no tenant) to rows with a null tenant", async () => {
    await logSystemEvent({
      category: "system",
      severity: "low",
      title: "Cron drift",
      error_key: "cron_drift",
    });

    const lookup = state.fake.calls.find((c) => c.table === "system_logs");
    expect(lookup?.filters.tenant_id).toBeNull();
  });
});
