// Single source of truth for the email "From" — mirrors src/lib/whatsapp/from.ts.
//
// WHY the owner cannot simply type any sender address: an ESP (Resend) only
// sends from a domain it has DNS-verified (SPF/DKIM). Putting
// "info@ristorantepippo.com" in the From of a mail relayed by our infrastructure
// gets rejected outright, or — worse — delivered and marked as spam because it
// fails DMARC. So the sending ADDRESS is a platform concern (EMAIL_FROM, one
// verified no-reply domain shared by every tenant), while the tenant controls
// the display NAME the guest actually reads ("Ristorante Picnic").
//
// Result: `Ristorante Picnic <no-reply@crm.example.com>`.
//
// Campaigns are SEND-ONLY by owner decision: no Reply-To is set and the email
// body tells the guest not to reply (see marketing/send.ts). A tenant that later
// verifies its OWN domain in Resend becomes a config change here, not a code one.

import type { TenantSettings } from "@/lib/types/tenant-settings";

const PLATFORM_FALLBACK = "TableFlow <onboarding@resend.dev>";

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

/** True once a platform sender domain is configured (EMAIL_FROM). Without it we
 *  fall back to Resend's sandbox address, which only reaches the Resend account
 *  owner — fine in dev, useless for real guests. */
export function emailSenderConfigured(): boolean {
  return !!process.env.EMAIL_FROM;
}

/**
 * Resolve the From header for a tenant's outbound email.
 * Display name: tenant's `sender_name` → tenant name → platform default.
 * Address: ALWAYS the platform's verified address (EMAIL_FROM).
 */
export function resolveEmailFrom(
  settings: TenantSettings | null | undefined,
  tenantName?: string | null,
): string {
  const platform = process.env.EMAIL_FROM || PLATFORM_FALLBACK;
  const address = addressOf(platform);

  const configured = settings?.marketing_email?.sender_name?.trim();
  const raw = configured || tenantName?.trim() || addressOf(platform).split("@")[0];
  const name = sanitizeDisplayName(raw);

  return name ? `${name} <${address}>` : platform;
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
