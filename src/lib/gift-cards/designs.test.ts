import { describe, expect, it } from "vitest";
import {
  findGiftDesign,
  giftDesignBackground,
  isValidGiftDesign,
  newGiftDesign,
  publishedGiftDesigns,
  MAX_GIFT_DESIGNS,
  type GiftDesign,
} from "./designs";
import { GIFT_MAX_CENTS, GIFT_MIN_CENTS } from "./gift-cards";

const base = (over: Partial<GiftDesign> = {}): GiftDesign => ({
  id: "gd_1",
  title: "Cena per due",
  amount_cents: 5000,
  style: "solid",
  color: "#c4956a",
  ...over,
});

describe("isValidGiftDesign", () => {
  it("accepts a well-formed solid card", () => {
    expect(isValidGiftDesign(base())).toBe(true);
  });

  it("rejects a card with no title", () => {
    expect(isValidGiftDesign(base({ title: "   " }))).toBe(false);
  });

  it("rejects amounts outside the purchase bounds", () => {
    expect(isValidGiftDesign(base({ amount_cents: GIFT_MIN_CENTS - 1 }))).toBe(false);
    expect(isValidGiftDesign(base({ amount_cents: GIFT_MAX_CENTS + 1 }))).toBe(false);
    expect(isValidGiftDesign(base({ amount_cents: GIFT_MIN_CENTS }))).toBe(true);
    expect(isValidGiftDesign(base({ amount_cents: GIFT_MAX_CENTS }))).toBe(true);
  });

  it("rejects a non-integer amount (a float from a text input)", () => {
    expect(isValidGiftDesign(base({ amount_cents: 5000.5 }))).toBe(false);
  });

  it("rejects an image card with no image", () => {
    expect(isValidGiftDesign(base({ style: "image" }))).toBe(false);
    expect(isValidGiftDesign(base({ style: "image", image_url: "https://x/y.webp" }))).toBe(true);
  });

  it("rejects malformed colours", () => {
    expect(isValidGiftDesign(base({ color: "red" }))).toBe(false);
    expect(isValidGiftDesign(base({ color: "#fff" }))).toBe(false);
    expect(isValidGiftDesign(base({ color2: "nope" }))).toBe(false);
    expect(isValidGiftDesign(base({ text_color: "nope" }))).toBe(false);
  });

  it("rejects junk", () => {
    expect(isValidGiftDesign(null)).toBe(false);
    expect(isValidGiftDesign(undefined)).toBe(false);
    expect(isValidGiftDesign({} as GiftDesign)).toBe(false);
  });
});

describe("publishedGiftDesigns", () => {
  it("returns [] for anything that isn't an array (legacy tenants have no key)", () => {
    expect(publishedGiftDesigns(undefined)).toEqual([]);
    expect(publishedGiftDesigns(null)).toEqual([]);
    expect(publishedGiftDesigns({})).toEqual([]);
  });

  it("drops invalid and disabled cards", () => {
    const out = publishedGiftDesigns([
      base({ id: "ok" }),
      base({ id: "off", enabled: false }),
      base({ id: "bad", title: "" }),
    ]);
    expect(out.map((d) => d.id)).toEqual(["ok"]);
  });

  it("treats an absent `enabled` as published (cards created before the flag)", () => {
    expect(publishedGiftDesigns([base({ id: "legacy" })])).toHaveLength(1);
  });

  it("caps the published list", () => {
    const many = Array.from({ length: MAX_GIFT_DESIGNS + 5 }, (_, i) => base({ id: `gd_${i}` }));
    expect(publishedGiftDesigns(many)).toHaveLength(MAX_GIFT_DESIGNS);
  });
});

describe("findGiftDesign", () => {
  const list = [base({ id: "a" }), base({ id: "b", enabled: false })];

  it("finds a published card", () => {
    expect(findGiftDesign(list, "a")?.id).toBe("a");
  });

  it("refuses a disabled card — a stale browser must not be able to buy it", () => {
    expect(findGiftDesign(list, "b")).toBeNull();
  });

  it("returns null for an unknown or missing id", () => {
    expect(findGiftDesign(list, "zzz")).toBeNull();
    expect(findGiftDesign(list, null)).toBeNull();
  });
});

describe("giftDesignBackground", () => {
  it("renders a solid fill", () => {
    expect(giftDesignBackground(base())).toBe("#c4956a");
  });

  it("renders a gradient, falling back to one colour when color2 is unset", () => {
    expect(giftDesignBackground(base({ style: "gradient", color2: "#000000" }))).toContain("#000000");
    expect(giftDesignBackground(base({ style: "gradient" }))).toBe(
      "linear-gradient(135deg, #c4956a, #c4956a)",
    );
  });

  it("scrims an image so the title stays readable on any photo", () => {
    const css = giftDesignBackground(base({ style: "image", image_url: "https://x/y.webp" }));
    expect(css).toContain("https://x/y.webp");
    expect(css).toContain("rgba(0,0,0,");
  });
});

describe("newGiftDesign", () => {
  it("prefills a card that is one title away from valid", () => {
    const d = newGiftDesign("#123456");
    expect(d.color).toBe("#123456");
    expect(isValidGiftDesign(d)).toBe(false); // no title yet
    expect(isValidGiftDesign({ ...d, title: "Cena" })).toBe(true);
  });

  it("falls back to the house accent when handed a junk colour", () => {
    expect(newGiftDesign("not-a-colour").color).toBe("#c4956a");
  });
});
