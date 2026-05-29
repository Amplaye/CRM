import { describe, it, expect, afterEach } from "vitest";
import { resolveWhatsAppFrom, tenantWhatsAppFrom } from "./from";

// Mossa 5 (PIANO_SAAS): the WhatsApp sending number is per-tenant CONFIG, not
// code. After the Meta migration (2026-05-29) the sender is a Meta
// phone_number_id (bare digits), resolved tenant → platform env → empty.
// These lock that order so a future edit can't quietly re-hardcode one number.
describe("resolveWhatsAppFrom — sending number (Meta phone_number_id) is per-tenant config [Mossa 5]", () => {
  const original = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    else process.env.META_WHATSAPP_PHONE_NUMBER_ID = original;
  });

  it("uses the tenant's own phone_number_id when set (the SaaS path)", () => {
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "1000000000000";
    expect(resolveWhatsAppFrom("2222222222222")).toBe("2222222222222");
  });

  it("strips any stray whatsapp: prefix or '+' to a bare phone_number_id", () => {
    expect(resolveWhatsAppFrom("whatsapp:+1095078260361095")).toBe("1095078260361095");
    expect(resolveWhatsAppFrom("+1095078260361095")).toBe("1095078260361095");
  });

  it("falls back to the platform env number when the tenant has none", () => {
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "1000000000000";
    expect(resolveWhatsAppFrom(undefined)).toBe("1000000000000");
    expect(resolveWhatsAppFrom("")).toBe("1000000000000");
    expect(resolveWhatsAppFrom("   ")).toBe("1000000000000");
  });

  it("returns empty string when neither tenant nor env is set", () => {
    delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    expect(resolveWhatsAppFrom(undefined)).toBe("");
  });

  it("a tenant's number never leaks to a neighbour (resolution is per-call)", () => {
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = "1000000000000";
    expect(resolveWhatsAppFrom("3333333333333")).toBe("3333333333333");
    expect(resolveWhatsAppFrom(undefined)).toBe("1000000000000");
  });
});

describe("tenantWhatsAppFrom — reads settings.whatsapp.from safely", () => {
  it("returns the configured number", () => {
    expect(tenantWhatsAppFrom({ whatsapp: { from: "1095078260361095" } })).toBe("1095078260361095");
  });

  it("returns undefined when unset, wrong shape, or blank", () => {
    expect(tenantWhatsAppFrom(null)).toBeUndefined();
    expect(tenantWhatsAppFrom(undefined)).toBeUndefined();
    expect(tenantWhatsAppFrom({})).toBeUndefined();
    expect(tenantWhatsAppFrom({ whatsapp: {} })).toBeUndefined();
    expect(tenantWhatsAppFrom({ whatsapp: { from: "" } })).toBeUndefined();
    expect(tenantWhatsAppFrom({ whatsapp: { from: 123 as unknown as string } })).toBeUndefined();
  });
});
