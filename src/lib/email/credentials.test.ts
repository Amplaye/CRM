import { describe, it, expect, beforeAll } from "vitest";
import { encryptEmailSecret, decryptEmailSecret, resolveEmailApiKey } from "./credentials";

// The one invariant that matters here: a tenant with no key (or a key we can't
// read) must fall back to the shared platform pool rather than fail the send.

beforeAll(() => {
  process.env.EMAIL_CRED_ENC_KEY = "a".repeat(64); // valid 32-byte hex key
});

/** Minimal service-role client stand-in: returns whatever row the test sets. */
function fakeSvc(row: { secret_enc: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row }) }),
        }),
      }),
    }),
  };
}

describe("email credentials", () => {
  it("round-trips an API key through encrypt/decrypt", () => {
    const enc = encryptEmailSecret({ api_key: "re_test_123" });
    expect(enc).not.toContain("re_test_123"); // actually encrypted, not just encoded
    expect(decryptEmailSecret(enc)).toEqual({ api_key: "re_test_123" });
  });

  it("produces a different blob each time (fresh IV)", () => {
    const a = encryptEmailSecret({ api_key: "re_same" });
    const b = encryptEmailSecret({ api_key: "re_same" });
    expect(a).not.toEqual(b);
    expect(decryptEmailSecret(a)).toEqual(decryptEmailSecret(b));
  });

  it("rejects a tampered blob (GCM auth tag)", () => {
    const enc = encryptEmailSecret({ api_key: "re_test_123" });
    const [iv, tag, data] = enc.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptEmailSecret([iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("resolves the tenant's key when a row exists", async () => {
    const svc = fakeSvc({ secret_enc: encryptEmailSecret({ api_key: "re_tenant_key" }) });
    await expect(resolveEmailApiKey(svc, "tenant-1")).resolves.toBe("re_tenant_key");
  });

  it("returns null (→ shared pool) when the tenant has no row", async () => {
    await expect(resolveEmailApiKey(fakeSvc(null), "tenant-1")).resolves.toBeNull();
  });

  it("returns null (→ shared pool) on an undecryptable blob instead of throwing", async () => {
    const svc = fakeSvc({ secret_enc: "not:a:valid-blob" });
    await expect(resolveEmailApiKey(svc, "tenant-1")).resolves.toBeNull();
  });

  it("returns null without a tenant id", async () => {
    await expect(resolveEmailApiKey(fakeSvc(null), "")).resolves.toBeNull();
  });
});
