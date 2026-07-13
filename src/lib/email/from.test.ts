import { describe, it, expect, afterEach } from "vitest";
import { resolveEmailFrom, resolveEmailBranding, addressOf, emailSenderConfigured } from "./from";
import type { TenantSettings } from "@/lib/types/tenant-settings";

const ORIGINAL = process.env.EMAIL_FROM;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = ORIGINAL;
});

describe("addressOf", () => {
  it("extracts the address from a Name <addr> header", () => {
    expect(addressOf("Picnic <no-reply@crm.example.com>")).toBe("no-reply@crm.example.com");
  });
  it("passes a bare address through", () => {
    expect(addressOf("no-reply@crm.example.com")).toBe("no-reply@crm.example.com");
  });
});

describe("resolveEmailFrom", () => {
  it("keeps the platform address and uses the tenant's configured sender name", () => {
    process.env.EMAIL_FROM = "TableFlow <no-reply@crm.example.com>";
    const settings = { marketing_email: { sender_name: "Ristorante Picnic" } } as TenantSettings;
    expect(resolveEmailFrom(settings, "Picnic")).toBe("Ristorante Picnic <no-reply@crm.example.com>");
  });

  it("falls back to the tenant name when no sender_name is set", () => {
    process.env.EMAIL_FROM = "TableFlow <no-reply@crm.example.com>";
    expect(resolveEmailFrom(null, "Picnic")).toBe("Picnic <no-reply@crm.example.com>");
  });

  it("NEVER lets a tenant hijack the address — an owner-typed domain is ignored", () => {
    process.env.EMAIL_FROM = "TableFlow <no-reply@crm.example.com>";
    // Even a sender_name shaped like an address can't change the sending domain.
    const settings = { marketing_email: { sender_name: "evil@attacker.com" } } as TenantSettings;
    expect(resolveEmailFrom(settings, "Picnic")).toBe("evil@attacker.com <no-reply@crm.example.com>");
  });

  it("strips header-injection characters from the display name", () => {
    process.env.EMAIL_FROM = "TableFlow <no-reply@crm.example.com>";
    const settings = { marketing_email: { sender_name: 'Bad"<x>\r\nBcc: v@x.com' } } as TenantSettings;
    const from = resolveEmailFrom(settings, "Picnic");
    expect(from).not.toContain("\r");
    expect(from).not.toContain("\n");
    // Angle brackets and quotes stripped; the leftover colon forces quoting, so
    // the injected "Bcc:" can never escape the display name into a real header.
    expect(from).toBe('"BadxBcc: v@x.com" <no-reply@crm.example.com>');
  });

  it("quotes a display name containing a comma (would otherwise split the header)", () => {
    process.env.EMAIL_FROM = "TableFlow <no-reply@crm.example.com>";
    const settings = { marketing_email: { sender_name: "Picnic, Bali" } } as TenantSettings;
    expect(resolveEmailFrom(settings, "x")).toBe('"Picnic, Bali" <no-reply@crm.example.com>');
  });
});

describe("emailSenderConfigured", () => {
  it("is false without EMAIL_FROM (sandbox fallback)", () => {
    delete process.env.EMAIL_FROM;
    expect(emailSenderConfigured()).toBe(false);
  });
  it("is true once EMAIL_FROM is set", () => {
    process.env.EMAIL_FROM = "TableFlow <no-reply@crm.example.com>";
    expect(emailSenderConfigured()).toBe(true);
  });
});

// Il logo può stare in due posti indipendenti (branding CRM, menu) a
// seconda di dove il titolare l'ha caricato. Le campagne leggevano SOLO
// menu_branding: un ristorante col logo caricato altrove riceveva un'email senza
// logo pur avendone uno (caso reale: tenant Oraz, logo in `branding`).
describe("resolveEmailBranding", () => {
  const url = (s: string) => `https://cdn.example.com/${s}.webp`;

  it("preferisce il logo del CRM a quello del menu", () => {
    const b = resolveEmailBranding(
      { branding: { logo_url: url("crm") }, menu_branding: { logo_url: url("menu") } } as never,
      "Picnic",
    );
    expect(b.logo_url).toBe(url("crm"));
    expect(b.name).toBe("Picnic");
  });

  it("NON usa site_branding.hero_url come logo (è una foto di copertina)", () => {
    const b = resolveEmailBranding({ site_branding: { hero_url: url("hero") } } as never, "X");
    expect(b.logo_url).toBeUndefined();
  });

  it("ripiega sul logo del CRM — il caso che prima usciva senza logo", () => {
    const b = resolveEmailBranding({ branding: { logo_url: url("crm") } } as never, "Oraz");
    expect(b.logo_url).toBe(url("crm"));
  });

  it("ripiega sul logo del menu quando è l'unico presente", () => {
    const b = resolveEmailBranding({ menu_branding: { logo_url: url("menu") } } as never, "X");
    expect(b.logo_url).toBe(url("menu"));
  });

  it("nessun logo → undefined (il layout mostra il nome come wordmark)", () => {
    expect(resolveEmailBranding({} as never, "X").logo_url).toBeUndefined();
    expect(resolveEmailBranding(null, "X").logo_url).toBeUndefined();
  });
});
