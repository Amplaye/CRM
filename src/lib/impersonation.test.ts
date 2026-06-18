import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

// Pin a deterministic secret BEFORE the module's secret() is read (it's read
// lazily at call time, so setting it here is enough).
const SECRET = "test-secret-impersonation";
beforeAll(() => { process.env.IMPERSONATION_SECRET = SECRET; });

import { signImpersonationToken, verifyImpersonationToken } from "./impersonation";

function craft(tenantId: string, adminId: string, expEpochSec: number): string {
  const payload = `${tenantId}.${adminId}.${expEpochSec}`;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

describe("impersonation token", () => {
  it("round-trips a freshly signed token", () => {
    const token = signImpersonationToken("tenant-123", "admin-abc");
    expect(verifyImpersonationToken(token)).toEqual({ tenantId: "tenant-123", adminUserId: "admin-abc" });
  });

  it("rejects a token whose signature was tampered with", () => {
    const token = signImpersonationToken("tenant-123", "admin-abc");
    // Flip the last hex char of the signature (same length → hits timingSafeEqual).
    const flipped = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifyImpersonationToken(flipped)).toBeNull();
  });

  it("rejects a token signed with a different secret (a non-admin can't forge one)", () => {
    const payload = "tenant-123.admin-abc." + (Math.floor(Date.now() / 1000) + 3600);
    const forgedSig = crypto.createHmac("sha256", "attacker-secret").update(payload).digest("hex");
    expect(verifyImpersonationToken(`${payload}.${forgedSig}`)).toBeNull();
  });

  it("rejects an expired token even when correctly signed", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(verifyImpersonationToken(craft("tenant-123", "admin-abc", past))).toBeNull();
  });

  it("accepts a correctly-signed, unexpired token (craft matches impl)", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(verifyImpersonationToken(craft("tenant-9", "admin-9", future)))
      .toEqual({ tenantId: "tenant-9", adminUserId: "admin-9" });
  });

  it("rejects malformed tokens", () => {
    expect(verifyImpersonationToken("")).toBeNull();
    expect(verifyImpersonationToken("a.b.c")).toBeNull();
    expect(verifyImpersonationToken("only-one-part")).toBeNull();
  });
});
