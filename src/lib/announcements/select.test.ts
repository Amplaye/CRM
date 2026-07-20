import { describe, it, expect } from "vitest";
import {
  isLiveAt,
  matchesAudience,
  pickAnnouncement,
  pickText,
  hasAnyText,
  sanitizeL10n,
  type Announcement,
} from "./select";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function make(over: Partial<Announcement> = {}): Announcement {
  return {
    id: "a1",
    slug: "social-2026-07",
    title: { it: "Nuova sezione Social", en: "New Social section" },
    body: { it: "Pubblica su Instagram", en: "Publish to Instagram" },
    cta_label: { it: "Scoprila", en: "Discover it" },
    cta_href: "/social",
    audience: "owner_manager",
    published: true,
    starts_at: "2026-07-19T00:00:00.000Z",
    ends_at: null,
    ...over,
  };
}

describe("isLiveAt", () => {
  it("shows a published announcement inside its window", () => {
    expect(isLiveAt(make(), NOW)).toBe(true);
  });

  it("hides a draft", () => {
    expect(isLiveAt(make({ published: false }), NOW)).toBe(false);
  });

  it("hides one scheduled for the future", () => {
    expect(isLiveAt(make({ starts_at: "2026-08-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("hides one that has expired", () => {
    expect(isLiveAt(make({ ends_at: "2026-07-20T11:59:00.000Z" }), NOW)).toBe(false);
  });

  it("shows one whose expiry is still ahead", () => {
    expect(isLiveAt(make({ ends_at: "2026-07-21T00:00:00.000Z" }), NOW)).toBe(true);
  });

  it("treats an unparseable date as not live rather than always-on", () => {
    expect(isLiveAt(make({ starts_at: "not a date" }), NOW)).toBe(false);
    expect(isLiveAt(make({ ends_at: "not a date" }), NOW)).toBe(false);
  });
});

describe("matchesAudience", () => {
  it("interrupts owners and managers for owner_manager", () => {
    for (const role of ["owner", "manager", "admin"]) {
      expect(matchesAudience(make(), role), role).toBe(true);
    }
  });

  it("leaves waiters alone for owner_manager", () => {
    for (const role of ["host", "marketing", "readonly"]) {
      expect(matchesAudience(make(), role), role).toBe(false);
    }
  });

  it("reaches everyone when audience is all", () => {
    expect(matchesAudience(make({ audience: "all" }), "host")).toBe(true);
  });

  it("shows nothing when the role is unknown", () => {
    // Better to skip the modal than interrupt someone we haven't identified.
    expect(matchesAudience(make(), null)).toBe(false);
    expect(matchesAudience(make({ audience: "all" }), null)).toBe(false);
  });
});

describe("pickAnnouncement", () => {
  it("returns the live one for an owner", () => {
    const picked = pickAnnouncement([make()], { role: "owner", now: NOW, dismissedIds: [] });
    expect(picked?.id).toBe("a1");
  });

  it("returns null once dismissed", () => {
    const picked = pickAnnouncement([make()], { role: "owner", now: NOW, dismissedIds: ["a1"] });
    expect(picked).toBeNull();
  });

  it("prefers the newest when two are live", () => {
    const older = make({ id: "old", starts_at: "2026-07-01T00:00:00.000Z" });
    const newer = make({ id: "new", starts_at: "2026-07-19T00:00:00.000Z" });
    const picked = pickAnnouncement([older, newer], { role: "owner", now: NOW, dismissedIds: [] });
    expect(picked?.id).toBe("new");
  });

  it("falls back to the older one when the newest is already dismissed", () => {
    const older = make({ id: "old", starts_at: "2026-07-01T00:00:00.000Z" });
    const newer = make({ id: "new", starts_at: "2026-07-19T00:00:00.000Z" });
    const picked = pickAnnouncement([older, newer], {
      role: "owner",
      now: NOW,
      dismissedIds: ["new"],
    });
    expect(picked?.id).toBe("old");
  });

  it("never interrupts a waiter with an owner_manager announcement", () => {
    const picked = pickAnnouncement([make()], { role: "host", now: NOW, dismissedIds: [] });
    expect(picked).toBeNull();
  });

  it("returns null on an empty list", () => {
    expect(pickAnnouncement([], { role: "owner", now: NOW, dismissedIds: [] })).toBeNull();
  });
});

describe("pickText", () => {
  it("returns the asked-for language", () => {
    expect(pickText({ it: "Ciao", en: "Hello" }, "it")).toBe("Ciao");
  });

  it("falls back to English when the language is missing", () => {
    expect(pickText({ en: "Hello" }, "de")).toBe("Hello");
  });

  it("falls back to any translation when English is missing too", () => {
    expect(pickText({ es: "Hola" }, "de")).toBe("Hola");
  });

  it("skips blank strings rather than rendering whitespace", () => {
    expect(pickText({ de: "   ", en: "Hello" }, "de")).toBe("Hello");
    expect(pickText({ de: "   ", en: "  " }, "de")).toBe("");
  });

  it("treats garbage as empty", () => {
    expect(pickText(null, "it")).toBe("");
    expect(pickText(undefined, "it")).toBe("");
    expect(pickText({}, "it")).toBe("");
  });
});

describe("hasAnyText", () => {
  it("accepts a blob with at least one translation", () => {
    expect(hasAnyText({ de: "Neu" })).toBe(true);
  });

  it("rejects empty or whitespace-only blobs", () => {
    expect(hasAnyText({})).toBe(false);
    expect(hasAnyText({ it: "  " })).toBe(false);
    expect(hasAnyText(null)).toBe(false);
  });
});

describe("sanitizeL10n", () => {
  it("keeps the four supported languages and trims them", () => {
    expect(sanitizeL10n({ it: " Ciao ", en: "Hi", es: "Hola", de: "Hallo" })).toEqual({
      it: "Ciao",
      en: "Hi",
      es: "Hola",
      de: "Hallo",
    });
  });

  it("drops unsupported keys and empty values", () => {
    expect(sanitizeL10n({ it: "Ciao", fr: "Salut", en: "   ", __proto__: "x" })).toEqual({
      it: "Ciao",
    });
  });

  it("treats garbage as an empty blob", () => {
    expect(sanitizeL10n(null)).toEqual({});
    expect(sanitizeL10n("nope")).toEqual({});
    expect(sanitizeL10n(42)).toEqual({});
  });
});
