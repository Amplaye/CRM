import { describe, it, expect, beforeAll } from "vitest";
import { encryptPaymentSecret, decryptPaymentSecret } from "./secrets";

// Payment secrets must round-trip and never appear in plaintext at rest.
describe("payment secret encryption", () => {
  beforeAll(() => {
    // 64-char hex → used directly as the 32-byte key.
    process.env.PAYMENT_CRED_ENC_KEY = "a".repeat(64);
  });

  it("round-trips an object", () => {
    const plain = { secret_key: "sk_live_xyz", account: "acct_1" };
    const enc = encryptPaymentSecret(plain);
    expect(enc).toContain(":"); // iv:tag:ciphertext
    expect(enc).not.toContain("sk_live_xyz"); // not plaintext
    expect(decryptPaymentSecret(enc)).toEqual(plain);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const a = encryptPaymentSecret({ k: "v" });
    const b = encryptPaymentSecret({ k: "v" });
    expect(a).not.toBe(b);
    expect(decryptPaymentSecret(a)).toEqual(decryptPaymentSecret(b));
  });

  it("rejects a tampered blob", () => {
    const enc = encryptPaymentSecret({ k: "v" });
    const [iv, tag, data] = enc.split(":");
    const tampered = [iv, tag, data.slice(0, -2) + "00"].join(":");
    expect(() => decryptPaymentSecret(tampered)).toThrow();
  });
});
