import { describe, it, expect, beforeAll } from "vitest";
import { encryptEmailSecret, decryptEmailSecret, resolveTenantEmail, readEmailSecret } from "./credentials";

// The one invariant that matters here: null means THIS TENANT SENDS NO EMAIL.
// There is no shared platform pool to fall back on, so every failure mode —
// missing row, unreadable blob, key without a verified sender — has to land on
// null and stop the send, never on somebody else's Resend account.

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

const full = { api_key: "re_tenant_key", from_address: "noreply@ristorantepicnic.com" };

describe("email credentials", () => {
  it("round-trips key + sender through encrypt/decrypt", () => {
    const enc = encryptEmailSecret(full);
    expect(enc).not.toContain("re_tenant_key"); // actually encrypted, not just encoded
    expect(decryptEmailSecret(enc)).toEqual(full);
  });

  it("produces a different blob each time (fresh IV)", () => {
    const a = encryptEmailSecret(full);
    const b = encryptEmailSecret(full);
    expect(a).not.toEqual(b);
    expect(decryptEmailSecret(a)).toEqual(decryptEmailSecret(b));
  });

  it("rejects a tampered blob (GCM auth tag)", () => {
    const enc = encryptEmailSecret(full);
    const [iv, tag, data] = enc.split(":");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptEmailSecret([iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("resolves key AND sender when the tenant is fully connected", async () => {
    const svc = fakeSvc({ secret_enc: encryptEmailSecret(full) });
    await expect(resolveTenantEmail(svc, "tenant-1")).resolves.toEqual({
      apiKey: "re_tenant_key",
      fromAddress: "noreply@ristorantepicnic.com",
    });
  });

  it("returns null when the tenant has no row → no email is sent for it", async () => {
    await expect(resolveTenantEmail(fakeSvc(null), "tenant-1")).resolves.toBeNull();
  });

  it("returns null for a key with NO sender address — every send would 403 anyway", async () => {
    const svc = fakeSvc({ secret_enc: encryptEmailSecret({ api_key: "re_tenant_key" }) });
    await expect(resolveTenantEmail(svc, "tenant-1")).resolves.toBeNull();
    // …but the raw read still surfaces the key, which is how Settings re-validates
    // a newly typed address without asking the owner to paste the key again.
    await expect(readEmailSecret(svc, "tenant-1")).resolves.toEqual({
      apiKey: "re_tenant_key",
      fromAddress: "",
    });
  });

  it("returns null on an undecryptable blob instead of throwing", async () => {
    const svc = fakeSvc({ secret_enc: "not:a:valid-blob" });
    await expect(resolveTenantEmail(svc, "tenant-1")).resolves.toBeNull();
  });

  it("returns null without a tenant id", async () => {
    await expect(resolveTenantEmail(fakeSvc(null), "")).resolves.toBeNull();
  });
});
