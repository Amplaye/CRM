import { describe, it, expect, beforeAll } from "vitest";
import { looksLikeStripeSecretKey, resolveTenantStripeKey } from "./tenant-stripe";
import { encryptPaymentSecret } from "./secrets";

// The tenant's own Stripe key is a live charging credential: the format gate
// must reject anything that isn't a secret/restricted key (a publishable
// pk_live_ pasted by mistake must never be stored), and resolution must fail
// SOFT to null — "no QR payments", never "charge on somebody else's account".

describe("looksLikeStripeSecretKey", () => {
  it("accepts secret and restricted keys, live and test", () => {
    expect(looksLikeStripeSecretKey("sk_live_" + "a".repeat(24))).toBe(true);
    expect(looksLikeStripeSecretKey("sk_test_" + "a".repeat(24))).toBe(true);
    expect(looksLikeStripeSecretKey("rk_live_" + "a".repeat(24))).toBe(true);
    expect(looksLikeStripeSecretKey("  sk_live_" + "a".repeat(24) + "  ")).toBe(true); // trimmed
  });

  it("rejects publishable keys, malformed and empty input", () => {
    expect(looksLikeStripeSecretKey("pk_live_" + "a".repeat(24))).toBe(false); // publishable ≠ secret
    expect(looksLikeStripeSecretKey("sk_live_short")).toBe(false);
    expect(looksLikeStripeSecretKey("whsec_" + "a".repeat(24))).toBe(false);
    expect(looksLikeStripeSecretKey("")).toBe(false);
    expect(looksLikeStripeSecretKey("sk_prod_" + "a".repeat(24))).toBe(false);
  });
});

// Minimal fake service-role client: only the chain resolveTenantStripeKey uses.
function fakeSvc(row: { secret_enc: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row }),
          }),
        }),
      }),
    }),
  };
}

describe("resolveTenantStripeKey", () => {
  beforeAll(() => {
    process.env.PAYMENT_CRED_ENC_KEY = "a".repeat(64);
  });

  const KEY = "sk_live_" + "x".repeat(24);

  it("returns the decrypted key when stored", async () => {
    const svc = fakeSvc({ secret_enc: encryptPaymentSecret({ secret_key: KEY }) });
    expect(await resolveTenantStripeKey(svc, "t1")).toBe(KEY);
  });

  it("returns null when nothing is stored", async () => {
    expect(await resolveTenantStripeKey(fakeSvc(null), "t1")).toBeNull();
  });

  it("returns null (fail-soft) on an undecryptable blob", async () => {
    expect(await resolveTenantStripeKey(fakeSvc({ secret_enc: "garbage" }), "t1")).toBeNull();
  });

  it("returns null when the stored value is not a plausible key", async () => {
    const svc = fakeSvc({ secret_enc: encryptPaymentSecret({ secret_key: "pk_live_" + "x".repeat(24) }) });
    expect(await resolveTenantStripeKey(svc, "t1")).toBeNull();
  });

  it("returns null for a missing tenant id", async () => {
    expect(await resolveTenantStripeKey(fakeSvc(null), "")).toBeNull();
  });
});
