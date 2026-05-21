import { describe, it, expect, afterEach } from "vitest";
import { resolveWhatsAppFrom, tenantWhatsAppFrom, TWILIO_SANDBOX_FROM } from "./from";

// Mossa 5 (PIANO_SAAS): the WhatsApp sending number is per-tenant CONFIG, not
// code. These lock the resolution order tenant → platform env → sandbox so a
// future edit can't quietly re-hardcode one number for everyone.
describe("resolveWhatsAppFrom — sending number is per-tenant config [Mossa 5]", () => {
  const original = process.env.TWILIO_WHATSAPP_FROM;
  afterEach(() => {
    if (original === undefined) delete process.env.TWILIO_WHATSAPP_FROM;
    else process.env.TWILIO_WHATSAPP_FROM = original;
  });

  it("uses the tenant's own number when set (the SaaS path)", () => {
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+10000000000";
    expect(resolveWhatsAppFrom("whatsapp:+34999888777")).toBe("whatsapp:+34999888777");
  });

  it("adds the whatsapp: prefix to a bare tenant number", () => {
    expect(resolveWhatsAppFrom("+34999888777")).toBe("whatsapp:+34999888777");
  });

  it("falls back to the platform env number when the tenant has none", () => {
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+10000000000";
    expect(resolveWhatsAppFrom(undefined)).toBe("whatsapp:+10000000000");
    expect(resolveWhatsAppFrom("")).toBe("whatsapp:+10000000000");
    expect(resolveWhatsAppFrom("   ")).toBe("whatsapp:+10000000000");
  });

  it("falls back to the Twilio sandbox when neither tenant nor env is set", () => {
    delete process.env.TWILIO_WHATSAPP_FROM;
    expect(resolveWhatsAppFrom(undefined)).toBe(TWILIO_SANDBOX_FROM);
  });

  it("a tenant's number never leaks to a neighbour (resolution is per-call)", () => {
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+10000000000";
    expect(resolveWhatsAppFrom("whatsapp:+34111111111")).toBe("whatsapp:+34111111111");
    expect(resolveWhatsAppFrom(undefined)).toBe("whatsapp:+10000000000");
  });
});

describe("tenantWhatsAppFrom — reads settings.whatsapp.from safely", () => {
  it("returns the configured number", () => {
    expect(tenantWhatsAppFrom({ whatsapp: { from: "whatsapp:+34000111222" } })).toBe("whatsapp:+34000111222");
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
