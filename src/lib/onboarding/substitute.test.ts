import { describe, it, expect } from "vitest";
import { substituteTenantTokens, resyncContactTokens, type OnboardSubstitutions, type ContactResync } from "./substitute";

// Minimal substitution input — only the fields these cases exercise.
function sub(overrides: Partial<OnboardSubstitutions>): OnboardSubstitutions {
  return {
    newTenantId: "00000000-0000-0000-0000-000000000000",
    newSlug: "bali-rest",
    newOwnerPhone: "+34684109244",
    newRestaurantName: "BALI Rest",
    newRestaurantPhone: "+34684109244",
    newReviewUrl: "",
    ...overrides,
  };
}

describe("substituteTenantTokens — restaurant phone tokens", () => {
  // The bug: the template embeds the national-only digits "828712623" right
  // after a literal "+34". Substituting them with the FULL number's digits
  // ("34684109244") produced "+3434684109244" — a doubled country code that
  // Meta/Twilio then sent to a malformed/wrong recipient.
  it("does NOT double the country code when the template token sits after a +34 literal", () => {
    const template = JSON.stringify({ code: "const PHONE = '+34828712623';" });
    const out = substituteTenantTokens(template, sub({ newRestaurantPhone: "+34684109244" }));
    expect(out).toContain("+34684109244");
    expect(out).not.toContain("+3434684109244");
    expect(out).not.toMatch(/\+?3434684109244/);
  });

  // The spaced BARE token must also drop the country code, regardless of whether
  // the new number itself has spaces (it usually won't).
  it("substitutes the spaced BARE token with the national part only", () => {
    const template = JSON.stringify({ display: "Llama al +34 828 712 623" });
    const out = substituteTenantTokens(template, sub({ newRestaurantPhone: "+34684109244" }));
    expect(out).toContain("684109244");
    expect(out).not.toMatch(/34684109244\d/); // no extra digits glued on
  });

  // A number supplied without the +34 prefix must not be corrupted: nationalDigits
  // leaves non-matching numbers as-is (longer-but-correct beats doubled-prefix).
  it("leaves a number without the +34 prefix as-is (no false stripping)", () => {
    const template = JSON.stringify({ code: "const D = '828712623';" });
    const out = substituteTenantTokens(template, sub({ newRestaurantPhone: "684109244" }));
    expect(out).toContain("684109244");
  });
});

// Minimal re-sync input — only the three baked contact fields.
function rsub(overrides: Partial<ContactResync>): ContactResync {
  return {
    oldOwnerPhone: "+34641790137",
    newOwnerPhone: "+34641790137",
    oldRestaurantPhone: "+34684109244",
    newRestaurantPhone: "+34684109244",
    oldReviewUrl: "https://g.page/old",
    newReviewUrl: "https://g.page/old",
    ...overrides,
  };
}

describe("resyncContactTokens — post-onboarding contact re-sync", () => {
  // Happy path: a clone that baked the old owner phone, restaurant phone (full
  // + national) and review url gets all three rewritten to the new values.
  it("rewrites owner phone, restaurant phone (full + national) and review url", () => {
    const clone = JSON.stringify({
      owner: "+34641790137",
      phoneFull: "+34684109244",
      phoneNat: "684109244",
      review: "https://g.page/old",
    });
    const out = resyncContactTokens(clone, rsub({
      oldOwnerPhone: "+34641790137", newOwnerPhone: "+34600111222",
      oldRestaurantPhone: "+34684109244", newRestaurantPhone: "+34999888777",
      oldReviewUrl: "https://g.page/old", newReviewUrl: "https://g.page/new",
    }));
    expect(out).toContain("+34600111222"); // new owner
    expect(out).toContain("+34999888777"); // new restaurant full
    expect(out).toContain("999888777");    // new restaurant national
    expect(out).toContain("https://g.page/new");
    expect(out).not.toContain("641790137");
    expect(out).not.toContain("684109244");
    expect(out).not.toContain("g.page/old");
  });

  // No-op: when every old equals its new, the JSON must come back byte-identical
  // (so the caller can detect "nothing changed" and skip the PUT).
  it("is a no-op when old === new for all fields", () => {
    const clone = JSON.stringify({ owner: "+34641790137", phone: "+34684109244", review: "https://g.page/old" });
    const out = resyncContactTokens(clone, rsub({}));
    expect(out).toBe(clone);
  });

  // Double-prefix guard: the national form is rewritten national→national, so a
  // value glued after a literal "+34" ("+34684109244") becomes "+34" + new
  // national — never a doubled "+3434…" (the inverse of the clone-time bug).
  it("does NOT double the country code when rewriting the national form glued after +34", () => {
    const clone = JSON.stringify({ code: "const PHONE = '+34684109244';" });
    const out = resyncContactTokens(clone, rsub({
      oldRestaurantPhone: "+34684109244", newRestaurantPhone: "+34999888777",
    }));
    expect(out).toContain("+34999888777");
    expect(out).not.toMatch(/\+?3434999888777/);
    expect(out).not.toMatch(/\+?34999888777\d/); // no extra digits glued on
  });

  // Short-string guard: a national run shorter than 7 digits is NOT substituted,
  // so it can't accidentally match inside arbitrary ids/numbers.
  it("does not rewrite a sub-7-digit national run", () => {
    const clone = JSON.stringify({ ref: "12345", id: "node-12345-abc" });
    const out = resyncContactTokens(clone, rsub({
      oldRestaurantPhone: "+3412345", newRestaurantPhone: "+3499999",
    }));
    expect(out).toBe(clone); // untouched: "12345" too short to be a phone
  });
});
