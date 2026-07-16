import { describe, it, expect } from "vitest";
import { mockAdapter, MOCK_CATALOG } from "@/lib/pos/adapters/mock";
import type { AdapterContext } from "@/lib/pos/types";

const ctx: AdapterContext = { tenantId: "tenant-A", credentials: {}, config: {} };
const params = { since: "2026-05-25T00:00:00Z", until: "2026-06-07T23:59:59Z" };

describe("mockAdapter", () => {
  it("is deterministic — same (tenant, window) yields identical sales", async () => {
    const a = await mockAdapter.fetchSales(ctx, params);
    const b = await mockAdapter.fetchSales(ctx, params);
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("a different tenant produces a different sales stream", async () => {
    const a = await mockAdapter.fetchSales(ctx, params);
    const b = await mockAdapter.fetchSales({ ...ctx, tenantId: "tenant-B" }, params);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it("external ids are unique within the stream (idempotent upsert key)", async () => {
    const sales = await mockAdapter.fetchSales(ctx, params);
    const ids = new Set(sales.map((s) => s.externalId));
    expect(ids.size).toBe(sales.length);
  });

  it("respects the canonical contract: delivery has fees + source + null covers", async () => {
    const sales = await mockAdapter.fetchSales(ctx, params);
    for (const s of sales) {
      expect(["sala", "asporto", "delivery"]).toContain(s.channel);
      if (s.channel === "delivery") {
        expect(s.feesTotal).toBeGreaterThan(0);
        expect(s.channelSource).toBeTruthy();
        expect(s.covers).toBeNull();
      } else {
        expect(s.feesTotal).toBe(0);
      }
      // gross total equals the sum of its line gross totals
      const lineSum = Math.round(s.items.reduce((a, it) => a + it.grossTotal, 0) * 100) / 100;
      expect(s.grossTotal).toBe(lineSum);
    }
  });

  it("fetchProducts returns the fixed catalogue", async () => {
    const products = await mockAdapter.fetchProducts(ctx);
    expect(products).toHaveLength(MOCK_CATALOG.length);
    expect(products[0]).toHaveProperty("externalProductId");
    expect(products[0]).toHaveProperty("price");
  });

  it("weekend days carry more volume than weekdays", async () => {
    // 2026-05-30 is a Saturday, 2026-05-27 a Wednesday
    const sat = await mockAdapter.fetchSales(ctx, { since: "2026-05-30T00:00:00Z", until: "2026-05-30T23:59:59Z" });
    const wed = await mockAdapter.fetchSales(ctx, { since: "2026-05-27T00:00:00Z", until: "2026-05-27T23:59:59Z" });
    expect(sat.length).toBeGreaterThan(wed.length);
  });
});
