import { describe, it, expect } from "vitest";
import { resolveNamedDate, revenueForWindow } from "@/lib/management/compare";
import type { SaleRow } from "@/lib/management/types";

// Anchor "now" on a known weekday: 2026-06-08 is a Monday.
const NOW = new Date("2026-06-08T10:00:00Z");

describe("resolveNamedDate", () => {
  it("today / yesterday", () => {
    expect(resolveNamedDate(NOW, "today")).toEqual({ from: "2026-06-08", to: "2026-06-08" });
    expect(resolveNamedDate(NOW, "yesterday")).toEqual({ from: "2026-06-07", to: "2026-06-07" });
  });
  it("ieri / ayer aliases", () => {
    expect(resolveNamedDate(NOW, "ieri")).toEqual({ from: "2026-06-07", to: "2026-06-07" });
    expect(resolveNamedDate(NOW, "ayer")).toEqual({ from: "2026-06-07", to: "2026-06-07" });
  });
  it("last_saturday → most recent past Saturday (2026-06-06)", () => {
    expect(resolveNamedDate(NOW, "last_saturday")).toEqual({ from: "2026-06-06", to: "2026-06-06" });
    expect(resolveNamedDate(NOW, "sabato")).toEqual({ from: "2026-06-06", to: "2026-06-06" });
  });
  it("this_week is Monday..today", () => {
    expect(resolveNamedDate(NOW, "this_week")).toEqual({ from: "2026-06-08", to: "2026-06-08" });
  });
  it("last_week is the previous Mon..Sun", () => {
    expect(resolveNamedDate(NOW, "last_week")).toEqual({ from: "2026-06-01", to: "2026-06-07" });
  });
  it("unknown name defaults to today", () => {
    expect(resolveNamedDate(NOW, "blah")).toEqual({ from: "2026-06-08", to: "2026-06-08" });
  });
});

describe("revenueForWindow", () => {
  const sales: SaleRow[] = [
    { businessDate: "2026-06-06", closedAt: "2026-06-06T21:00:00Z", channel: "sala", grossTotal: 0, netTotal: 500, feesTotal: 0, covers: 10 },
    { businessDate: "2026-06-07", closedAt: "2026-06-07T13:00:00Z", channel: "sala", grossTotal: 0, netTotal: 200, feesTotal: 0, covers: 4 },
    { businessDate: "2026-06-08", closedAt: "2026-06-08T13:00:00Z", channel: "sala", grossTotal: 0, netTotal: 150, feesTotal: 0, covers: 3 },
  ];
  it("sums revenue inside the window only", () => {
    expect(revenueForWindow(sales, { from: "2026-06-06", to: "2026-06-06" })).toBe(500);
    expect(revenueForWindow(sales, { from: "2026-06-07", to: "2026-06-08" })).toBe(350);
  });
  it("yesterday vs last_saturday is a verifiable delta", () => {
    const sat = revenueForWindow(sales, resolveNamedDate(NOW, "last_saturday")); // 500
    const yest = revenueForWindow(sales, resolveNamedDate(NOW, "yesterday")); // 200
    expect(sat - yest).toBe(300);
  });
});
