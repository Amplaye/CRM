import { describe, it, expect } from "vitest";
import { buildTenantExport } from "./export-tenant";

/** Minimal fake: .from(table).select(...).eq(...) resolves canned rows;
 * the tenants table resolves .single(). */
function fakeSupabase(data: Record<string, any[]>) {
  return {
    from(table: string) {
      const rows = data[table] || [];
      const builder: any = {
        select() { return builder; },
        eq() { return builder; },
        single: async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: "no row" } }),
        then(resolve: any) { resolve({ data: rows, error: null }); }, // awaitable for list queries
      };
      return builder;
    },
  };
}

describe("buildTenantExport", () => {
  it("collects the four data tables + tenant under one object", async () => {
    const supabase = fakeSupabase({
      tenants: [{ id: "t1", name: "Foo", status: "active", settings: {}, created_at: "2026-01-01" }],
      reservations: [{ id: "r1" }],
      guests: [{ id: "g1" }],
      conversations: [{ id: "c1" }],
      knowledge_articles: [{ id: "k1" }, { id: "k2" }],
    });
    const out = await buildTenantExport(supabase as any, "t1");
    expect(out.tenant.name).toBe("Foo");
    expect(out.reservations).toHaveLength(1);
    expect(out.guests).toHaveLength(1);
    expect(out.conversations).toHaveLength(1);
    expect(out.knowledge_articles).toHaveLength(2);
    expect(typeof out.exported_at).toBe("string");
  });

  it("throws when the tenant does not exist", async () => {
    const supabase = fakeSupabase({ tenants: [] });
    await expect(buildTenantExport(supabase as any, "missing")).rejects.toThrow(/not found/);
  });
});
