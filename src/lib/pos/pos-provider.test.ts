import { describe, it, expect } from "vitest";
import { getPosProvider, resolvePosProvider, applyPosProvider } from "@/lib/pos/pos-provider";

describe("getPosProvider", () => {
  it("defaults to mock when unset or unknown", () => {
    expect(getPosProvider(null)).toBe("mock");
    expect(getPosProvider({})).toBe("mock");
    expect(getPosProvider({ pos: { provider: "bogus" as any } })).toBe("mock");
  });
  it("reads an explicit provider", () => {
    expect(getPosProvider({ pos: { provider: "tilby" } })).toBe("tilby");
  });
});

describe("resolvePosProvider", () => {
  it("noop when already on target; real tills need credentials, mock doesn't", () => {
    expect(resolvePosProvider({ pos: { provider: "mock" } }, "mock").noop).toBe(true);
    const plan = resolvePosProvider({ pos: { provider: "mock" } }, "cassa_in_cloud");
    expect(plan).toMatchObject({ noop: false, from: "mock", to: "cassa_in_cloud", needsCredentials: true });
    expect(resolvePosProvider({}, "mock").needsCredentials).toBe(false);
  });
});

describe("applyPosProvider", () => {
  it("flips provider while preserving other settings", () => {
    const next = applyPosProvider({ timezone: "Europe/Rome", pos: { provider: "mock" } }, "tilby");
    expect(next.pos?.provider).toBe("tilby");
    expect(next.timezone).toBe("Europe/Rome");
  });
});
