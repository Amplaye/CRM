import { describe, it, expect, beforeAll } from "vitest";
import { encryptCredentials, decryptSecret } from "@/lib/pos/credentials";

describe("POS credential encryption (AES-256-GCM)", () => {
  beforeAll(() => {
    process.env.POS_CRED_ENC_KEY = "test-passphrase-not-hex";
  });

  it("round-trips an object", () => {
    const plain = { apiKey: "sk-secret", shopId: 42, nested: { a: [1, 2, 3] } };
    const enc = encryptCredentials(plain);
    expect(enc).toContain(":");
    expect(enc).not.toContain("sk-secret"); // never stores plaintext
    expect(decryptSecret(enc)).toEqual(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptCredentials({ a: 1 })).not.toEqual(encryptCredentials({ a: 1 }));
  });

  it("rejects a tampered blob (auth tag)", () => {
    const enc = encryptCredentials({ a: 1 });
    const [iv, tag, data] = enc.split(":");
    const tampered = [iv, tag, data.slice(0, -2) + (data.endsWith("AA") ? "BB" : "AA")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
