import { describe, it, expect } from "vitest";
import {
  regionFor, getComplianceConfig, isRetentionEnabled, getAiDisclosure, REGIONS,
} from "./regions";

describe("regionFor", () => {
  it("resolves each supported country", () => {
    expect(regionFor("ES").framework).toContain("LOPDGDD");
    expect(regionFor("it").country).toBe("IT"); // case-insensitive
    expect(regionFor("DE").residency).toBe("eu");
    expect(regionFor("CH").dpaTemplate).toBe("revfadp");
  });
  it("falls back to EU-strict for unset/unknown", () => {
    expect(regionFor(null).aiDisclosureDefault).toBe(true);
    expect(regionFor("XX").defaultRetentionDays).toBe(30);
  });
});

describe("getComplianceConfig", () => {
  it("uses region defaults when nothing is overridden", () => {
    const cfg = getComplianceConfig({ compliance: { country: "IT" } });
    expect(cfg.country).toBe("IT");
    expect(cfg.retentionDays).toBe(REGIONS.IT.defaultRetentionDays);
    expect(cfg.aiDisclosure).toBe(true);
    expect(cfg.retentionEnabled).toBe(true);
  });
  it("lets an explicit retention_days override the region default", () => {
    const cfg = getComplianceConfig({ compliance: { country: "ES", retention_days: 90 } });
    expect(cfg.retentionDays).toBe(90);
  });
  it("ignores a non-positive retention override", () => {
    const cfg = getComplianceConfig({ compliance: { country: "ES", retention_days: 0 } });
    expect(cfg.retentionDays).toBe(REGIONS.ES.defaultRetentionDays);
  });
  it("honours an explicit ai_disclosure=false override", () => {
    const cfg = getComplianceConfig({ compliance: { country: "DE", ai_disclosure: false } });
    expect(cfg.aiDisclosure).toBe(false);
  });
  it("is retention-DISABLED when no country and no retention_days (safe default)", () => {
    expect(getComplianceConfig({}).retentionEnabled).toBe(false);
    expect(getComplianceConfig(null).retentionEnabled).toBe(false);
    expect(isRetentionEnabled(undefined)).toBe(false);
  });
  it("is retention-ENABLED when only retention_days is set (no country)", () => {
    const cfg = getComplianceConfig({ compliance: { retention_days: 60 } });
    expect(cfg.country).toBe(null);
    expect(cfg.retentionEnabled).toBe(true);
    expect(cfg.retentionDays).toBe(60);
  });
});

describe("getAiDisclosure", () => {
  it("builds a localized line and appends the privacy URL", () => {
    const d = getAiDisclosure(
      { compliance: { country: "IT", privacy_url: "https://x/p" } },
      "Trattoria",
    );
    expect(d.enabled).toBe(true);
    expect(d.text).toContain("Trattoria");
    expect(d.text).toContain("assistente AI");
    expect(d.text).toContain("https://x/p");
  });
  it("respects a language override", () => {
    const d = getAiDisclosure({ compliance: { country: "ES" } }, "Bar", "de");
    expect(d.text).toContain("KI-Assistenten");
  });
  it("is disabled (empty text) when disclosure is forced off", () => {
    const d = getAiDisclosure({ compliance: { country: "CH", ai_disclosure: false } }, "Klinik");
    expect(d.enabled).toBe(false);
    expect(d.text).toBe("");
  });
});
