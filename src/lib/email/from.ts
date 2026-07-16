// Single source of truth for the email "From" — mirrors src/lib/whatsapp/from.ts.
//
// An ESP only relays a From on a domain it has DNS-verified (SPF/DKIM) IN THE
// ACCOUNT THE KEY BELONGS TO. Since every CRM email now goes out on the tenant's
// own Resend key, the address has to sit on the TENANT's own verified domain —
// the platform's no-reply domain would come back `403 "The <domain> domain is
// not verified"` (reproduced against the live API), because that domain is
// verified in OUR account, not theirs.
//
// So the address travels with the key (email_secrets.from_address, chosen from
// the domains the tenant verified on Resend) and the tenant controls only the
// display NAME laid on top of it.
//
// Result: `Ristorante Picnic <noreply@ristorantepicnic.com>`.
//
// Campaigns are SEND-ONLY by owner decision: no Reply-To is set and the email
// body tells the guest not to reply (see marketing/send.ts).

import type { TenantSettings } from "@/lib/types/tenant-settings";

/** Bare address out of an RFC-5322 `Name <addr@host>` (or a bare address). */
export function addressOf(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}

/** Strip anything that would break (or inject into) a From header. */
function sanitizeDisplayName(raw: string): string {
  const clean = raw.replace(/[<>"\r\n]/g, "").trim();
  // A comma or semicolon would split the header into two addresses — quote it.
  return /[,;:]/.test(clean) ? `"${clean}"` : clean;
}

/** Domain part, lowercased. "" when the input isn't an address. */
export function domainOf(raw: string): string {
  return (addressOf(raw).split("@")[1] || "").toLowerCase().trim();
}

const ADDRESS_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[a-z]{2,}$/i;

/** Shape check only — whether Resend will ACCEPT it depends on the domain being
 *  verified in the tenant's account (senderOnVerifiedDomain). */
export function isEmailAddress(raw: string): boolean {
  return ADDRESS_RE.test(raw.trim());
}

/** What we propose the moment a tenant connects a key: a no-reply on the domain
 *  it just verified. Campaigns are send-only, so no-reply is the honest local
 *  part — and it's an address Resend will accept without further DNS work. */
export function defaultSenderAddress(domain: string): string {
  return `noreply@${domain.toLowerCase().trim()}`;
}

/** The one check that decides whether a send will be accepted or 403'd: the
 *  address must be on a domain the tenant verified in ITS OWN Resend account. */
export function senderOnVerifiedDomain(address: string, verifiedDomains: string[]): boolean {
  const d = domainOf(address);
  if (!d || !isEmailAddress(addressOf(address))) return false;
  return verifiedDomains.some((v) => v.toLowerCase().trim() === d);
}

/**
 * Resolve the From header for a tenant's outbound email.
 * Display name: tenant's `sender_name` → tenant name → the address's local part.
 * Address: the tenant's OWN verified sender (email_secrets.from_address).
 */
export function resolveEmailFrom(
  settings: TenantSettings | null | undefined,
  tenantName: string | null | undefined,
  fromAddress: string,
): string {
  const address = addressOf(fromAddress);
  const configured = settings?.marketing_email?.sender_name?.trim();
  const raw = configured || tenantName?.trim() || address.split("@")[0];
  const name = sanitizeDisplayName(raw);
  return name ? `${name} <${address}>` : address;
}

/**
 * Branding for the email header — the logo renderEmailLayout puts top-centre.
 *
 * The logo lives in TWO independent places depending on where the owner uploaded
 * it: the CRM chrome (`branding.logo_url`) or the public menu
 * (`menu_branding.logo_url`). Campaigns used to read ONLY `menu_branding`, so a
 * restaurant whose logo sat in `branding` got a logo-less email while its logo
 * was right there in settings (real case: tenant Oraz). Resolving both in one
 * place is what keeps that from regressing.
 *
 * Note `site_branding` has NO logo — it carries `hero_url`, a cover photo. Using
 * it here would put a wide hero shot where a logo belongs.
 */
export function resolveEmailBranding(
  settings: TenantSettings | null | undefined,
  tenantName?: string | null,
): { name: string; brand_color?: string; logo_url?: string } {
  const s = settings as (TenantSettings & { branding?: { logo_url?: string } }) | null | undefined;
  return {
    name: tenantName?.trim() || "",
    brand_color: s?.site_branding?.brand_color || s?.menu_branding?.brand_color,
    logo_url: s?.branding?.logo_url || s?.menu_branding?.logo_url,
  };
}
