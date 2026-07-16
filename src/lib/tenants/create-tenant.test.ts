import { describe, it, expect } from "vitest";
import { createTenant } from "./create-tenant";

/** Chainable stub mimicking the one query createTenant runs:
 *  .from('tenants').insert(row).select('id').single()
 *  Captures the inserted row so we can assert on it. */
function fakeClient(opts: { id?: string; error?: { message: string } } = {}) {
  const captured: { row?: Record<string, any> } = {};
  const chain: any = {
    from() { return chain; },
    insert(row: Record<string, any>) { captured.row = row; return chain; },
    select() { return chain; },
    single() {
      return Promise.resolve(
        opts.error
          ? { data: null, error: opts.error }
          : { data: { id: opts.id ?? "new-id" }, error: null }
      );
    },
  };
  return { client: chain as Parameters<typeof createTenant>[0], captured };
}

describe("createTenant — the single way to create a tenant", () => {
  it("always writes business_type=restaurant (single vertical by design)", async () => {
    // Even if a rogue business_type rides along in settings, the COLUMN stays restaurant.
    const { client, captured } = fakeClient();
    await createTenant(client, {
      name: "Rogue",
      settings: { business_type: "ecommerce" },
      status: "trial",
    });
    expect(captured.row?.business_type).toBe("restaurant");
  });

  it("writes the explicit lifecycle status the call site chose", async () => {
    // self-signup → trial, demo/wizard → active. The status must travel verbatim.
    const a = fakeClient();
    await createTenant(a.client, { name: "Self-signup", settings: {}, status: "trial" });
    expect(a.captured.row?.status).toBe("trial");

    const b = fakeClient();
    await createTenant(b.client, { name: "Demo", settings: {}, status: "active" });
    expect(b.captured.row?.status).toBe("active");
  });

  it("returns the new tenant id", async () => {
    const { client } = fakeClient({ id: "abc-123" });
    const res = await createTenant(client, { name: "X", settings: {}, status: "active" });
    expect(res.id).toBe("abc-123");
  });

  it("throws an explicit error when the insert fails (no silent swallow)", async () => {
    const { client } = fakeClient({ error: { message: "duplicate key" } });
    await expect(
      createTenant(client, { name: "X", settings: {}, status: "active" })
    ).rejects.toThrow(/tenant insert: duplicate key/);
  });

  // Regression guard: `tenants.slug` is NOT NULL with no default. Leaving it
  // unset is exactly what silently 500'd self-signup (register-tenant → insert
  // with null slug → fail → owner left with no tenant → wizard skipped). The
  // helper must ALWAYS write a non-empty slug.
  it("always writes a non-empty slug derived from the name", async () => {
    const { client, captured } = fakeClient();
    await createTenant(client, { name: "Trattoria Rossa", settings: {}, status: "trial" });
    expect(captured.row?.slug).toBeTruthy();
    expect(captured.row?.slug).toMatch(/^trattoria-rossa-[a-z0-9]+$/);
  });

  it("falls back to a usable slug when the name has no slug-able characters", async () => {
    const { client, captured } = fakeClient();
    await createTenant(client, { name: "🍕🍕", settings: {}, status: "trial" });
    expect(captured.row?.slug).toMatch(/^resto-[a-z0-9]+$/);
  });

  it("honours an explicit slug when the call site supplies one", async () => {
    const { client, captured } = fakeClient();
    await createTenant(client, { name: "Whatever", settings: {}, status: "active", slug: "my-slug" });
    expect(captured.row?.slug).toMatch(/^my-slug-[a-z0-9]+$/);
  });
});
