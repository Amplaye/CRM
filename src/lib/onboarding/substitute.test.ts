import { describe, it, expect } from "vitest";
import { substituteTenantTokens, type OnboardSubstitutions } from "./substitute";

// Minimal substitution input — only the STABLE fields the clone still bakes.
function sub(overrides: Partial<OnboardSubstitutions>): OnboardSubstitutions {
  return {
    newTenantId: "00000000-0000-0000-0000-000000000000",
    newSlug: "bali-rest",
    newRestaurantName: "BALI Rest",
    ...overrides,
  };
}

const TEMPLATE_TENANT_ID = "626547ff-bc44-4f35-8f42-0e97f1dcf0d5";
const TEMPLATE_VAPI_ID = "6c92f776-abb2-4175-8a55-45d76ec01d1a";

describe("substituteTenantTokens — stable tokens", () => {
  it("rewrites the template tenant_id everywhere (the live-config lookup key)", () => {
    const template = JSON.stringify({
      a: `url=...tenants?id=eq.${TEMPLATE_TENANT_ID}&select=settings`,
      b: `tenant_id=eq.${TEMPLATE_TENANT_ID}`,
    });
    const out = substituteTenantTokens(template, sub({ newTenantId: "11111111-1111-1111-1111-111111111111" }));
    expect(out).toContain("11111111-1111-1111-1111-111111111111");
    expect(out).not.toContain(TEMPLATE_TENANT_ID);
  });

  it("rewrites the Vapi assistant id only when provided", () => {
    const template = JSON.stringify({ assistantId: TEMPLATE_VAPI_ID });
    const withId = substituteTenantTokens(template, sub({ newVapiAssistantId: "aaaa-bbbb" }));
    expect(withId).toContain("aaaa-bbbb");
    expect(withId).not.toContain(TEMPLATE_VAPI_ID);
    // Omitted → the template id is left intact (caller didn't clone an assistant).
    const without = substituteTenantTokens(template, sub({}));
    expect(without).toContain(TEMPLATE_VAPI_ID);
  });

  it("rewrites picnic-* webhook paths to the new slug", () => {
    const template = JSON.stringify({ path: "picnic-whatsapp", audit: "picnic-audit-run" });
    const out = substituteTenantTokens(template, sub({ newSlug: "trattoria-rossa" }));
    expect(out).toContain("trattoria-rossa-whatsapp");
    expect(out).toContain("trattoria-rossa-audit-run");
    expect(out).not.toContain("picnic-");
  });

  it("rewrites standalone PICNIC / Picnic restaurant-name tokens", () => {
    const template = JSON.stringify({ name: "[Picnic] Reminders", upper: "Bienvenido a PICNIC" });
    const out = substituteTenantTokens(template, sub({ newRestaurantName: "BALI Rest" }));
    expect(out).toContain("BALI Rest");
    expect(out).toContain("BALI REST");
    expect(out).not.toMatch(/\bPicnic\b/);
    expect(out).not.toMatch(/\bPICNIC\b/);
  });
});

describe("substituteTenantTokens — mutable contacts are NOT baked", () => {
  // The three mutable contacts (owner_phone, restaurant_phone, review_url) are
  // read LIVE from the DB by the cloned workflows, so substitution must leave
  // those literals untouched (they remain inert Picnic fallbacks behind the live
  // read). This is the whole point of the 2026-06-03 definitive fix: editing a
  // contact in Settings → Bookings takes effect without re-cloning.
  it("leaves owner phone, restaurant phone and review url literals untouched", () => {
    const template = JSON.stringify({
      owner: "+34641790137",
      restoFull: "+34 828 712 623",
      restoNat: "828712623",
      review: "https://www.google.com/maps?cid=975701473301178074",
    });
    const out = substituteTenantTokens(template, sub({}));
    // Unchanged — the clone reads these from the DB at runtime, not from the JSON.
    expect(out).toContain("+34641790137");
    expect(out).toContain("+34 828 712 623");
    expect(out).toContain("828712623");
    expect(out).toContain("cid=975701473301178074");
  });
});
