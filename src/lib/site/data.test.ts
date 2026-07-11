import { describe, expect, it } from "vitest";
import { buildFullMenu, buildHoursRows, buildMapsHref, firstName, formatSitePrice, pickMenuTeaser } from "./data";
import type { OpeningHours } from "@/lib/restaurant-rules";

const DAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

describe("site data shaping", () => {
  it("formats prices dropping .00 and mapping EUR to €", () => {
    expect(formatSitePrice(12, "EUR")).toBe("12 €");
    expect(formatSitePrice(9.5, "EUR")).toBe("9.50 €");
    expect(formatSitePrice(7, "USD")).toBe("7 USD");
  });

  it("keeps only the first name of a guest", () => {
    expect(firstName("María García López")).toBe("María");
    expect(firstName(null)).toBe("Guest");
    expect(firstName("  ")).toBe("Guest");
  });

  it("prefers dishes with a photo when at least 3 have one", () => {
    const mk = (id: string, img: string | null) => ({
      id, name: id, description: "", price: 10, currency: "EUR", image_url: img,
    });
    const rows = [mk("a", null), mk("b", "x"), mk("c", "x"), mk("d", "x"), mk("e", null)];
    expect(pickMenuTeaser(rows).map((r) => r.id)).toEqual(["b", "c", "d"]);
    // Fewer than 3 with photo → keep menu order.
    const few = [mk("a", null), mk("b", "x"), mk("c", null)];
    expect(pickMenuTeaser(few).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("defaults allergens/tags to empty arrays in the teaser", () => {
    const [shaped] = pickMenuTeaser([
      { id: "a", name: "A", description: null, price: 8, currency: "EUR", image_url: "x" },
    ]);
    expect(shaped.allergens).toEqual([]);
    expect(shaped.tags).toEqual([]);
  });

  it("groups the full menu by category, dropping empty ones and bucketing loose dishes", () => {
    const item = (id: string, category_id: string | null) => ({
      id, name: id.toUpperCase(), description: "", price: 10, currency: "EUR",
      image_url: null, category_id, allergens: ["glutine"], tags: ["vegano"],
    });
    const items = [item("a", "c1"), item("b", "c1"), item("c", null)];
    const cats = [{ id: "c1", name: "Primi" }, { id: "c2", name: "Vuota" }];
    const menu = buildFullMenu(items, cats, "Altro");
    // "Vuota" (no items) is dropped; loose dish goes to the "Altro" bucket last.
    expect(menu.map((c) => c.name)).toEqual(["Primi", "Altro"]);
    expect(menu[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(menu[1].id).toBe("__uncat__");
    expect(menu[0].items[0].allergens).toEqual(["glutine"]);
    expect(menu[0].items[0].tags).toEqual(["vegano"]);
  });

  it("returns an empty full menu when there are no items", () => {
    expect(buildFullMenu([], [{ id: "c1", name: "Primi" }], "Altro")).toEqual([]);
  });

  it("builds Monday-first hour rows and hides when empty", () => {
    const hours: OpeningHours = { "0": [{ open: "13:00", close: "16:00" }], "1": [] };
    const rows = buildHoursRows(hours, DAYS, "Chiuso");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({ day: "Lun", value: "Chiuso" }); // Monday first
    expect(rows[6]).toEqual({ day: "Dom", value: "13:00–16:00" }); // Sunday last
    expect(buildHoursRows({} as OpeningHours, DAYS, "Chiuso")).toEqual([]);
  });

  it("builds a maps href from short link or address", () => {
    expect(buildMapsHref({ maps_short: "https://da.gd/x" })).toBe("https://da.gd/x");
    expect(buildMapsHref({ address: "C. Pelota 18", city: "Las Palmas" })).toContain("C.%20Pelota%2018%2C%20Las%20Palmas");
    expect(buildMapsHref({})).toBe("");
  });
});
