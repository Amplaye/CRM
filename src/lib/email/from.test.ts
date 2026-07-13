import { describe, it, expect } from "vitest";
import {
  resolveEmailFrom,
  resolveEmailBranding,
  addressOf,
  domainOf,
  isEmailAddress,
  defaultSenderAddress,
  senderOnVerifiedDomain,
} from "./from";
import type { TenantSettings } from "@/lib/types/tenant-settings";

const TENANT_SENDER = "noreply@ristorantepicnic.com";

describe("addressOf", () => {
  it("extracts the address from a Name <addr> header", () => {
    expect(addressOf("Picnic <noreply@ristorantepicnic.com>")).toBe("noreply@ristorantepicnic.com");
  });
  it("passes a bare address through", () => {
    expect(addressOf("noreply@ristorantepicnic.com")).toBe("noreply@ristorantepicnic.com");
  });
});

describe("resolveEmailFrom", () => {
  it("puts the tenant's sender name on the tenant's OWN verified address", () => {
    const settings = { marketing_email: { sender_name: "Ristorante Picnic" } } as TenantSettings;
    expect(resolveEmailFrom(settings, "Picnic", TENANT_SENDER)).toBe(
      "Ristorante Picnic <noreply@ristorantepicnic.com>",
    );
  });

  it("falls back to the tenant name when no sender_name is set", () => {
    expect(resolveEmailFrom(null, "Picnic", TENANT_SENDER)).toBe("Picnic <noreply@ristorantepicnic.com>");
  });

  it("the display name can never change the sending address", () => {
    // A sender_name shaped like an address is still just a name.
    const settings = { marketing_email: { sender_name: "evil@attacker.com" } } as TenantSettings;
    expect(resolveEmailFrom(settings, "Picnic", TENANT_SENDER)).toBe(
      "evil@attacker.com <noreply@ristorantepicnic.com>",
    );
  });

  it("strips header-injection characters from the display name", () => {
    const settings = { marketing_email: { sender_name: 'Bad"<x>\r\nBcc: v@x.com' } } as TenantSettings;
    const from = resolveEmailFrom(settings, "Picnic", TENANT_SENDER);
    expect(from).not.toContain("\r");
    expect(from).not.toContain("\n");
    // Angle brackets and quotes stripped; the leftover colon forces quoting, so
    // the injected "Bcc:" can never escape the display name into a real header.
    expect(from).toBe('"BadxBcc: v@x.com" <noreply@ristorantepicnic.com>');
  });

  it("quotes a display name containing a comma (would otherwise split the header)", () => {
    const settings = { marketing_email: { sender_name: "Picnic, Bali" } } as TenantSettings;
    expect(resolveEmailFrom(settings, "x", TENANT_SENDER)).toBe('"Picnic, Bali" <noreply@ristorantepicnic.com>');
  });
});

// The check that decides whether Resend accepts or 403s the send. Reproduced
// against the live API: sending from a domain verified in ANOTHER account comes
// back `403 "The <domain> domain is not verified"`. So a tenant's From must be on
// a domain verified inside the tenant's OWN account — never the platform's.
describe("senderOnVerifiedDomain", () => {
  const verified = ["ristorantepicnic.com", "picnic-events.es"];

  it("accepts an address on a verified domain", () => {
    expect(senderOnVerifiedDomain("noreply@ristorantepicnic.com", verified)).toBe(true);
  });

  it("accepts it case-insensitively (Resend domains are lowercase)", () => {
    expect(senderOnVerifiedDomain("NoReply@RistorantePicnic.COM", verified)).toBe(true);
  });

  it("REFUSES the platform's own domain — it isn't verified in the tenant's account", () => {
    expect(senderOnVerifiedDomain("noreply@crm.baliflowagency.com", verified)).toBe(false);
  });

  it("refuses a subdomain of a verified domain (Resend verifies exact hosts)", () => {
    expect(senderOnVerifiedDomain("noreply@mail.ristorantepicnic.com", verified)).toBe(false);
  });

  it("refuses anything when the account has verified nothing", () => {
    expect(senderOnVerifiedDomain("noreply@ristorantepicnic.com", [])).toBe(false);
  });

  it("refuses junk that isn't an address at all", () => {
    expect(senderOnVerifiedDomain("ristorantepicnic.com", verified)).toBe(false);
    expect(senderOnVerifiedDomain("", verified)).toBe(false);
  });
});

describe("domainOf / isEmailAddress / defaultSenderAddress", () => {
  it("reads the domain out of a full header or a bare address", () => {
    expect(domainOf("Picnic <noreply@Ristorante.com>")).toBe("ristorante.com");
    expect(domainOf("noreply@ristorante.com")).toBe("ristorante.com");
    expect(domainOf("not-an-address")).toBe("");
  });

  it("recognises addresses and rejects near-misses", () => {
    expect(isEmailAddress("noreply@ristorante.com")).toBe(true);
    expect(isEmailAddress("noreply@ristorante")).toBe(false);
    expect(isEmailAddress("noreply at ristorante.com")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
  });

  it("proposes no-reply on the domain the tenant just verified", () => {
    expect(defaultSenderAddress("Ristorante.com")).toBe("noreply@ristorante.com");
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
