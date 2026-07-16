import { describe, it, expect } from "vitest";
import { buildConsentRecord, normalizeSubjectRef } from "./consent";

describe("normalizeSubjectRef", () => {
  it("collapses phone punctuation, keeps the leading +", () => {
    expect(normalizeSubjectRef("+34 612-345 678")).toBe("+34612345678");
    expect(normalizeSubjectRef("0034 612 345 678")).toBe("0034612345678");
  });
  it("lowercases and trims emails/ids", () => {
    expect(normalizeSubjectRef("  Ana@MAIL.com ")).toBe("ana@mail.com");
  });
});

describe("buildConsentRecord", () => {
  const NOW = "2026-07-02T10:00:00.000Z";

  it("builds a normalized, defaulted record", () => {
    const rec = buildConsentRecord(
      { tenant_id: "t1", subject_ref: "+34 612 345 678", purpose: "store_allergy_for_kitchen", evidence: "  sì  " },
      NOW,
    );
    expect(rec).toMatchObject({
      tenant_id: "t1",
      subject_ref: "+34612345678",
      purpose: "store_allergy_for_kitchen",
      data_category: "health",
      channel: "whatsapp",
      granted: true,
      policy_version: "v1",
      evidence: "sì",
      created_at: NOW,
    });
  });

  it("respects granted=false and a chosen category/channel", () => {
    const rec = buildConsentRecord(
      { tenant_id: "t1", subject_ref: "x", purpose: "p", granted: false, data_category: "accessibility", channel: "voice" },
      NOW,
    );
    expect(rec.granted).toBe(false);
    expect(rec.data_category).toBe("accessibility");
    expect(rec.channel).toBe("voice");
  });

  it("throws on missing required fields", () => {
    expect(() => buildConsentRecord({ tenant_id: "", subject_ref: "x", purpose: "p" }, NOW)).toThrow(/tenant_id/);
    expect(() => buildConsentRecord({ tenant_id: "t", subject_ref: "", purpose: "p" }, NOW)).toThrow(/subject_ref/);
    expect(() => buildConsentRecord({ tenant_id: "t", subject_ref: "x", purpose: "" }, NOW)).toThrow(/purpose/);
  });

  it("rejects an invalid category/channel", () => {
    expect(() => buildConsentRecord({ tenant_id: "t", subject_ref: "x", purpose: "p", data_category: "bogus" as any }, NOW)).toThrow(/data_category/);
    expect(() => buildConsentRecord({ tenant_id: "t", subject_ref: "x", purpose: "p", channel: "bogus" as any }, NOW)).toThrow(/channel/);
  });
});
