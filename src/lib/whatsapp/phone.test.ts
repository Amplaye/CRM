import { describe, it, expect } from "vitest";
import { isSendableGuestPhone } from "./phone";

describe("isSendableGuestPhone", () => {
  it("accepts valid IT/ES numbers", () => {
    expect(isSendableGuestPhone("+34641790137")).toBe(true);
    expect(isSendableGuestPhone("+34612345678")).toBe(true);
    expect(isSendableGuestPhone("+393331234567")).toBe(true);
    expect(isSendableGuestPhone("+390612345678")).toBe(true);
  });

  it("accepts common tourist country codes", () => {
    expect(isSendableGuestPhone("+441234567890")).toBe(true); // UK
    expect(isSendableGuestPhone("+4915112345678")).toBe(true); // DE
  });

  it("rejects the mangled STT number from the live call", () => {
    // Philippines prefix + missing digit — the exact bug we are guarding against.
    expect(isSendableGuestPhone("+6341790137")).toBe(false);
  });

  it("rejects placeholders and junk", () => {
    expect(isSendableGuestPhone("+34600000000")).toBe(false);
    expect(isSendableGuestPhone("+390000000000")).toBe(false);
    expect(isSendableGuestPhone("+3")).toBe(false);
    expect(isSendableGuestPhone("")).toBe(false);
    expect(isSendableGuestPhone(null)).toBe(false);
    expect(isSendableGuestPhone(undefined)).toBe(false);
  });

  it("rejects numbers without a leading +", () => {
    expect(isSendableGuestPhone("34641790137")).toBe(false);
  });
});
