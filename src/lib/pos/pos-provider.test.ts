import { describe, it, expect } from "vitest";
import { getPosProvider, resolvePosProvider, applyPosProvider } from "@/lib/pos/pos-provider";

describe("getPosProvider", () => {
  it("defaults to mock when unset or unknown", () => {
    expect(getPosProvider(null)).toBe("mock");
    expect(getPosProvider({})).toBe("mock");
    expect(getPosProvider({ pos: { provider: "bogus" as any } })).toBe("mock");
  });
  it("reads an explicit provider", () => {
    expect(getPosProvider({ pos: { provider: "loyverse" } })).toBe("loyverse");
  });
});

describe("resolvePosProvider", () => {
  it("noop when already on target; real tills need credentials, mock doesn't", () => {
    expect(resolvePosProvider({ pos: { provider: "mock" } }, "mock").noop).toBe(true);
    const plan = resolvePosProvider({ pos: { provider: "mock" } }, "loyverse");
    expect(plan).toMatchObject({ noop: false, from: "mock", to: "loyverse", needsCredentials: true });
    expect(resolvePosProvider({}, "mock").needsCredentials).toBe(false);
  });
});

describe("the built-in till as a provider", () => {
  // Regression: "cassa" used to fall through to DEFAULT_PROVIDER, so a tenant
  // that had switched to the built-in till read back as "mock" — i.e. as if no
  // till had been chosen. fn_cassa_pay_atomic already stamps provider='cassa'
  // on pos_sales, so the resolver has to recognise the same value.
  it("resolves 'cassa' instead of silently falling back to mock", () => {
    expect(getPosProvider({ pos: { provider: "cassa" } })).toBe("cassa");
  });

  it("needs no credentials — there is nothing to authenticate against", () => {
    expect(resolvePosProvider({ pos: { provider: "loyverse" } }, "cassa")).toMatchObject({
      noop: false,
      from: "loyverse",
      to: "cassa",
      needsCredentials: false,
    });
  });

  it("switching from an external till is not a noop", () => {
    expect(resolvePosProvider({ pos: { provider: "loyverse" } }, "cassa").noop).toBe(false);
    expect(resolvePosProvider({ pos: { provider: "cassa" } }, "cassa").noop).toBe(true);
  });

  it("preserves the rest of settings when switching", () => {
    const next = applyPosProvider({ timezone: "Europe/Madrid", pos: { provider: "loyverse" } }, "cassa");
    expect(next.pos?.provider).toBe("cassa");
    expect(next.timezone).toBe("Europe/Madrid");
  });
});

describe("applyPosProvider", () => {
  it("flips provider while preserving other settings", () => {
    const next = applyPosProvider({ timezone: "Europe/Rome", pos: { provider: "mock" } }, "loyverse");
    expect(next.pos?.provider).toBe("loyverse");
    expect(next.timezone).toBe("Europe/Rome");
  });
});
