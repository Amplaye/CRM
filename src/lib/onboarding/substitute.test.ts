import { describe, it, expect } from "vitest";
import { substituteTenantTokens, type OnboardSubstitutions } from "./substitute";

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
