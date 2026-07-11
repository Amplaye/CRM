import { describe, expect, it } from "vitest";
import { resolveMenuClick, labelsForMenuLocale } from "./SiteMenuOverlay";

// The overlay uses ONE delegated document click listener so templates need no
// per-link/per-card wiring. resolveMenuClick is the pure decision it makes:
// a known dish card opens its detail; a "/m/<slug>" anchor opens the in-site
// full menu (instead of navigating away); anything else passes through.

const MENU = "/m/bali-rest";

describe("resolveMenuClick", () => {
  it("opens a dish detail when the click is on a known dish card", () => {
    expect(resolveMenuClick({ dishId: "d1", dishKnown: true, href: null, menuHref: MENU })).toEqual({
      type: "dish",
      id: "d1",
    });
  });

  it("ignores a dish card whose id is not in the menu (stale data)", () => {
    expect(resolveMenuClick({ dishId: "ghost", dishKnown: false, href: null, menuHref: MENU })).toBeNull();
  });

  it("opens the full menu for the exact /m/<slug> href", () => {
    expect(resolveMenuClick({ dishId: null, dishKnown: false, href: MENU, menuHref: MENU })).toEqual({ type: "full" });
  });

  it("opens the full menu for /m/<slug> with a trailing query or hash", () => {
    expect(resolveMenuClick({ dishId: null, dishKnown: false, href: `${MENU}?x=1`, menuHref: MENU })).toEqual({ type: "full" });
    expect(resolveMenuClick({ dishId: null, dishKnown: false, href: `${MENU}#top`, menuHref: MENU })).toEqual({ type: "full" });
  });

  it("does NOT hijack a different tenant's or unrelated menu link", () => {
    expect(resolveMenuClick({ dishId: null, dishKnown: false, href: "/m/other-slug", menuHref: MENU })).toBeNull();
    expect(resolveMenuClick({ dishId: null, dishKnown: false, href: "/g/bali-rest", menuHref: MENU })).toBeNull();
    // a longer path that merely starts with the slug but isn't the menu route
    expect(resolveMenuClick({ dishId: null, dishKnown: false, href: `${MENU}-extra`, menuHref: MENU })).toBeNull();
  });

  it("prefers the dish action when a dish card also sits inside a menu link", () => {
    expect(resolveMenuClick({ dishId: "d2", dishKnown: true, href: MENU, menuHref: MENU })).toEqual({
      type: "dish",
      id: "d2",
    });
  });
});

describe("labelsForMenuLocale", () => {
  it("passes through supported locales and falls back to it", () => {
    expect(labelsForMenuLocale("es")).toBe("es");
    expect(labelsForMenuLocale("de")).toBe("de");
    expect(labelsForMenuLocale("pt" as never)).toBe("it");
  });
});
