import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the shared transport so the adapter is exercised against canned Loyverse
// payloads — no network. Each test queues responses; posFetch shifts them in
// call order and returns a Response-like object whose .json() yields the body.
const responses: any[] = [];
vi.mock("@/lib/pos/transport", () => ({
  posFetch: vi.fn(async (url: string) => {
    if (responses.length === 0) throw new Error(`unexpected posFetch call: ${url}`);
    const body = responses.shift();
    return { ok: true, json: async () => body } as unknown as Response;
  }),
}));

import { loyverseAdapter } from "@/lib/pos/adapters/loyverse";
import { posFetch } from "@/lib/pos/transport";
import type { AdapterContext } from "@/lib/pos/types";

const ctx: AdapterContext = {
  tenantId: "tenant-A",
  credentials: { access_token: "tok_test_123" },
  config: { currency: "EUR" },
};
const params = { since: "2026-06-01T00:00:00.000Z", until: "2026-06-07T23:59:59.000Z" };

function queue(...bodies: any[]) {
  responses.length = 0;
  responses.push(...bodies);
}

beforeEach(() => {
  (posFetch as any).mockClear();
  responses.length = 0;
});

describe("loyverseAdapter.testConnection", () => {
  it("sends a Bearer token and reports the store name", async () => {
    queue({ stores: [{ name: "Trattoria Demo" }] });
    const r = await loyverseAdapter.testConnection(ctx);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("Trattoria Demo");
    const [, init] = (posFetch as any).mock.calls[0];
    expect((init.headers as any).Authorization).toBe("Bearer tok_test_123");
  });

  it("throws a clear error when the token is missing", async () => {
    await expect(
      loyverseAdapter.testConnection({ ...ctx, credentials: {} }),
    ).rejects.toThrow(/access_token mancante/);
  });
});

describe("loyverseAdapter.fetchSales — mapping", () => {
  it("maps a dine-in receipt onto the canonical shape", async () => {
    queue({
      receipts: [
        {
          receipt_number: "1-1001",
          receipt_type: "SALE",
          receipt_date: "2026-06-03T20:15:00.000Z",
          dining_option: "Dine in",
          total_money: 24.0,
          total_tax: 2.18,
          total_discount: 0,
          tip: 1.0,
          currency: "EUR",
          line_items: [
            {
              item_name: "Pizza Margherita",
              variant_id: "var-marg",
              quantity: 2,
              price: 7.0,
              gross_total_money: 14.0,
              line_taxes: [{ rate: 10 }],
            },
            {
              item_name: "Calice Vino Rosso",
              variant_id: "var-vino",
              quantity: 2,
              price: 5.0,
              gross_total_money: 10.0,
              line_taxes: [{ rate: 22 }],
            },
          ],
          payments: [{ name: "Carta", money: 24.0 }],
        },
      ],
      cursor: null,
    });

    const sales = await loyverseAdapter.fetchSales(ctx, params);
    expect(sales).toHaveLength(1);
    const s = sales[0];
    expect(s.externalId).toBe("1-1001");
    expect(s.channel).toBe("sala");
    expect(s.businessDate).toBe("2026-06-03");
    expect(s.grossTotal).toBe(24.0);
    expect(s.taxTotal).toBe(2.18);
    expect(s.netTotal).toBe(21.82);
    expect(s.tipTotal).toBe(1.0);
    expect(s.covers).toBeNull();
    expect(s.feesTotal).toBe(0);
    expect(s.paymentMethod).toBe("card");
    expect(s.items).toHaveLength(2);
    expect(s.items[0]).toMatchObject({
      externalProductId: "var-marg",
      name: "Pizza Margherita",
      quantity: 2,
      unitPrice: 7.0,
      grossTotal: 14.0,
      taxRate: 10,
    });
    // gross total equals the sum of line gross totals
    const lineSum = Math.round(s.items.reduce((a, it) => a + it.grossTotal, 0) * 100) / 100;
    expect(s.grossTotal).toBe(lineSum);
  });

  it("maps dining options to channels (takeout→asporto, delivery→delivery)", async () => {
    queue({
      receipts: [
        { receipt_number: "a", receipt_date: "2026-06-03T13:00:00Z", dining_option: "Takeout", total_money: 10, total_tax: 0, line_items: [], payments: [{ name: "Cash", money: 10 }] },
        { receipt_number: "b", receipt_date: "2026-06-03T13:05:00Z", dining_option: "Delivery", total_money: 10, total_tax: 0, line_items: [], payments: [] },
        { receipt_number: "c", receipt_date: "2026-06-03T13:10:00Z", dining_option: null, total_money: 10, total_tax: 0, line_items: [], payments: [] },
      ],
      cursor: null,
    });
    const sales = await loyverseAdapter.fetchSales(ctx, params);
    expect(sales.map((s) => s.channel)).toEqual(["asporto", "delivery", "sala"]);
    expect(sales[0].paymentMethod).toBe("cash");
    expect(sales[1].paymentMethod).toBeNull(); // no payments
  });

  it("skips REFUND and cancelled receipts", async () => {
    queue({
      receipts: [
        { receipt_number: "sale-1", receipt_type: "SALE", receipt_date: "2026-06-03T20:00:00Z", total_money: 30, total_tax: 0, line_items: [], payments: [] },
        { receipt_number: "ref-1", receipt_type: "REFUND", receipt_date: "2026-06-03T20:05:00Z", total_money: -30, total_tax: 0, line_items: [], payments: [] },
        { receipt_number: "canc-1", receipt_type: "SALE", receipt_date: "2026-06-03T20:10:00Z", cancelled_at: "2026-06-03T20:11:00Z", total_money: 15, total_tax: 0, line_items: [], payments: [] },
      ],
      cursor: null,
    });
    const sales = await loyverseAdapter.fetchSales(ctx, params);
    expect(sales).toHaveLength(1);
    expect(sales[0].externalId).toBe("sale-1");
  });

  it("follows the cursor across pages and forwards the date window", async () => {
    queue(
      { receipts: [{ receipt_number: "p1", receipt_date: "2026-06-02T12:00:00Z", total_money: 5, total_tax: 0, line_items: [], payments: [] }], cursor: "CUR2" },
      { receipts: [{ receipt_number: "p2", receipt_date: "2026-06-04T12:00:00Z", total_money: 5, total_tax: 0, line_items: [], payments: [] }], cursor: null },
    );
    const sales = await loyverseAdapter.fetchSales(ctx, params);
    expect(sales.map((s) => s.externalId)).toEqual(["p1", "p2"]);
    // first page carries the date filter, second page carries the cursor
    const firstUrl = (posFetch as any).mock.calls[0][0] as string;
    const secondUrl = (posFetch as any).mock.calls[1][0] as string;
    expect(firstUrl).toContain("created_at_min=2026-06-01T00%3A00%3A00.000Z");
    expect(firstUrl).toContain("created_at_max=2026-06-07T23%3A59%3A59.000Z");
    expect(secondUrl).toContain("cursor=CUR2");
  });

  it("derives unitPrice from the line total when price is absent", async () => {
    queue({
      receipts: [
        {
          receipt_number: "x",
          receipt_date: "2026-06-03T20:00:00Z",
          total_money: 18,
          total_tax: 0,
          line_items: [{ item_name: "Tagliata", variant_id: "v", quantity: 3, gross_total_money: 18 }],
          payments: [],
        },
      ],
      cursor: null,
    });
    const sales = await loyverseAdapter.fetchSales(ctx, params);
    expect(sales[0].items[0].unitPrice).toBe(6); // 18 / 3
    expect(sales[0].items[0].taxRate).toBeNull();
  });
});

describe("loyverseAdapter.pushProductPrice", () => {
  it("updates ONLY the target variant's price and re-POSTs the whole item", async () => {
    queue(
      // GET /items page (finding the item that owns the variant)
      {
        items: [
          {
            id: "item-1",
            item_name: "Pizza Margherita",
            category_id: "cat-1",
            variants: [
              { variant_id: "var-A", default_price: 7, stores: [{ store_id: "s1", price: 7 }] },
              { variant_id: "var-B", default_price: 9, stores: [{ store_id: "s1", price: 9 }] },
            ],
          },
        ],
        cursor: null,
      },
      // POST /items response (echoes saved item with new price)
      {
        id: "item-1",
        item_name: "Pizza Margherita",
        variants: [
          { variant_id: "var-A", default_price: 8.5, stores: [{ store_id: "s1", price: 8.5 }] },
          { variant_id: "var-B", default_price: 9, stores: [{ store_id: "s1", price: 9 }] },
        ],
      },
    );

    const res = await loyverseAdapter.pushProductPrice!(ctx, { externalProductId: "var-A", price: 8.5 });
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("8.5");

    // Inspect the POST body: var-A is 8.5 everywhere, var-B untouched at 9.
    const postCall = (posFetch as any).mock.calls[1];
    expect(postCall[1].method).toBe("POST");
    const body = JSON.parse(postCall[1].body);
    const a = body.variants.find((v: any) => v.variant_id === "var-A");
    const b = body.variants.find((v: any) => v.variant_id === "var-B");
    expect(a.default_price).toBe(8.5);
    expect(a.stores[0].price).toBe(8.5);
    expect(b.default_price).toBe(9); // sibling variant preserved
  });

  it("returns ok:false when the product isn't found", async () => {
    queue({ items: [{ id: "item-1", variants: [{ variant_id: "other" }] }], cursor: null });
    const res = await loyverseAdapter.pushProductPrice!(ctx, { externalProductId: "missing", price: 5 });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/non trovato/);
  });

  it("rejects an invalid price without any network call", async () => {
    const res = await loyverseAdapter.pushProductPrice!(ctx, { externalProductId: "var-A", price: -1 });
    expect(res.ok).toBe(false);
    expect((posFetch as any).mock.calls.length).toBe(0);
  });
});

describe("loyverseAdapter.fetchProducts", () => {
  it("joins categories and emits one product per variant", async () => {
    queue(
      // /categories
      { categories: [{ id: "cat-pizze", name: "Pizze" }], cursor: null },
      // /items
      {
        items: [
          {
            id: "item-marg",
            item_name: "Pizza Margherita",
            category_id: "cat-pizze",
            variants: [
              { variant_id: "var-small", default_price: 6 },
              { variant_id: "var-large", default_price: 9 },
            ],
          },
          { id: "item-acqua", item_name: "Acqua", category_id: null, variants: [] },
        ],
        cursor: null,
      },
    );
    const products = await loyverseAdapter.fetchProducts(ctx);
    expect(products).toHaveLength(3);
    expect(products[0]).toMatchObject({ externalProductId: "var-small", name: "Pizza Margherita", category: "Pizze", price: 6 });
    expect(products[1]).toMatchObject({ externalProductId: "var-large", price: 9 });
    // item with no variants falls back to the item id, null price
    expect(products[2]).toMatchObject({ externalProductId: "item-acqua", category: null, price: null });
  });
});

describe("loyverseAdapter.pushProduct — create", () => {
  it("POSTs a new item without category and returns the new variant id", async () => {
    queue(
      // POST /items response (Loyverse mints the item + variant ids)
      { id: "item-new", item_name: "Tiramisù", variants: [{ variant_id: "var-new", default_price: 6 }] },
    );
    const res = await loyverseAdapter.pushProduct!(ctx, { name: "Tiramisù", price: 6 });
    expect(res.ok).toBe(true);
    expect(res.externalProductId).toBe("var-new");
    // exactly one POST to /items, carrying the name + price, no category lookup
    expect((posFetch as any).mock.calls).toHaveLength(1);
    const [url, init] = (posFetch as any).mock.calls[0];
    expect(url).toContain("/items");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.item_name).toBe("Tiramisù");
    expect(body.variants[0].default_price).toBe(6);
    expect(body.category_id).toBeUndefined();
  });

  it("ensures the category exists (creating it) before POSTing the item", async () => {
    queue(
      // GET /categories — "Dolci" doesn't exist yet
      { categories: [{ id: "cat-pizze", name: "Pizze" }], cursor: null },
      // POST /categories — create "Dolci"
      { id: "cat-dolci", name: "Dolci" },
      // POST /items — the new product, tagged with the created category
      { id: "item-new", item_name: "Tiramisù", variants: [{ variant_id: "var-new", default_price: 6 }] },
    );
    const res = await loyverseAdapter.pushProduct!(ctx, { name: "Tiramisù", price: 6, category: "Dolci" });
    expect(res.ok).toBe(true);
    expect(res.externalProductId).toBe("var-new");
    const itemPost = (posFetch as any).mock.calls[2];
    const body = JSON.parse(itemPost[1].body);
    expect(body.category_id).toBe("cat-dolci");
  });

  it("rejects an empty name without any network call", async () => {
    const res = await loyverseAdapter.pushProduct!(ctx, { name: "   " });
    expect(res.ok).toBe(false);
    expect((posFetch as any).mock.calls.length).toBe(0);
  });
});

describe("loyverseAdapter.pushProduct — rename", () => {
  it("renames the parent item, keeping its variants/prices untouched", async () => {
    queue(
      // GET /items — find the item owning var-A
      {
        items: [
          {
            id: "item-1",
            item_name: "Pizza Margherita",
            variants: [{ variant_id: "var-A", default_price: 7, stores: [{ store_id: "s1", price: 7 }] }],
          },
        ],
        cursor: null,
      },
      // POST /items — echoes the renamed item
      { id: "item-1", item_name: "Pizza Regina", variants: [{ variant_id: "var-A", default_price: 7 }] },
    );
    const res = await loyverseAdapter.pushProduct!(ctx, { externalProductId: "var-A", name: "Pizza Regina" });
    expect(res.ok).toBe(true);
    expect(res.externalProductId).toBe("var-A");
    const postCall = (posFetch as any).mock.calls[1];
    const body = JSON.parse(postCall[1].body);
    expect(body.item_name).toBe("Pizza Regina");
    // the variant + its price survive the rename
    expect(body.variants[0].variant_id).toBe("var-A");
    expect(body.variants[0].default_price).toBe(7);
  });

  it("returns ok:false when the product to rename isn't found", async () => {
    queue({ items: [{ id: "item-1", variants: [{ variant_id: "other" }] }], cursor: null });
    const res = await loyverseAdapter.pushProduct!(ctx, { externalProductId: "missing", name: "X" });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/non trovato/);
  });
});

describe("loyverseAdapter.pushStock", () => {
  it("resolves the store, ensures track_stock, then POSTs to /inventory", async () => {
    queue(
      // GET /stores?limit=1 (no store_id in config → resolve the first store)
      { stores: [{ id: "store-1", name: "Trattoria Demo" }] },
      // GET /items (ensureTrackStock) — item ALREADY tracks stock → no re-POST
      { items: [{ id: "item-1", track_stock: true, variants: [{ variant_id: "var-A" }] }], cursor: null },
      // POST /inventory response
      { inventory_levels: [{ variant_id: "var-A", store_id: "store-1", stock_after: 42 }] },
    );
    const res = await loyverseAdapter.pushStock!(ctx, { externalProductId: "var-A", quantity: 42 });
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("42");
    // last call is the inventory POST
    const calls = (posFetch as any).mock.calls;
    const invPost = calls[calls.length - 1];
    expect(invPost[0]).toContain("/inventory");
    expect(invPost[1].method).toBe("POST");
    const body = JSON.parse(invPost[1].body);
    expect(body.inventory_levels[0]).toMatchObject({ variant_id: "var-A", store_id: "store-1", stock_after: 42 });
  });

  it("flips track_stock on the item when it isn't tracking yet", async () => {
    const ctxWithStore: AdapterContext = { ...ctx, config: { store_id: "store-cfg" } };
    queue(
      // GET /items (ensureTrackStock) — item does NOT track stock yet
      { items: [{ id: "item-1", track_stock: false, item_name: "X", variants: [{ variant_id: "var-A" }] }], cursor: null },
      // POST /items — enabling track_stock
      { id: "item-1", track_stock: true, variants: [{ variant_id: "var-A" }] },
      // POST /inventory
      { inventory_levels: [{ variant_id: "var-A", store_id: "store-cfg", stock_after: 10 }] },
    );
    const res = await loyverseAdapter.pushStock!(ctxWithStore, { externalProductId: "var-A", quantity: 10 });
    expect(res.ok).toBe(true);
    const calls = (posFetch as any).mock.calls;
    // the track_stock-enabling POST to /items carried track_stock:true
    const itemPost = calls.find((c: any) => c[0].includes("/items") && c[1]?.method === "POST");
    expect(JSON.parse(itemPost[1].body).track_stock).toBe(true);
    // inventory write used the configured store, no /stores lookup
    expect(calls.some((c: any) => c[0].includes("/stores"))).toBe(false);
    const invPost = calls[calls.length - 1];
    expect(JSON.parse(invPost[1].body).inventory_levels[0].store_id).toBe("store-cfg");
  });

  it("rejects a non-finite quantity without any network call", async () => {
    const res = await loyverseAdapter.pushStock!(ctx, { externalProductId: "var-A", quantity: NaN });
    expect(res.ok).toBe(false);
    expect((posFetch as any).mock.calls.length).toBe(0);
  });
});
