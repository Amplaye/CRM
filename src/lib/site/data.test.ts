import { describe, expect, it } from "vitest";
import { buildHoursRows, buildMapsHref, firstName, formatSitePrice, pickMenuTeaser } from "./data";
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
