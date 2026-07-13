// Single source of truth for the email "From" — mirrors src/lib/whatsapp/from.ts.
//
// WHY the owner cannot simply type any sender address: an ESP (Resend) only
// sends from a domain it has DNS-verified (SPF/DKIM). Putting
// "info@ristorantepippo.com" in the From of a mail relayed by our infrastructure
// gets rejected outright, or — worse — delivered and marked as spam because it
// fails DMARC. So the sending ADDRESS is a platform concern (EMAIL_FROM, one
// verified domain), while what the tenant controls is:
//
//   • sender_name → the display name the guest actually reads ("Ristorante Picnic")
//   • reply_to    → where the guest's reply lands (the venue's real inbox)
//
// Result: `Ristorante Picnic <no-reply@crm.example.com>`, Reply-To: info@venue.com.
// A tenant that later verifies its OWN domain in Resend becomes a config change
// here, not a code change.

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

/** The tenant's Reply-To (its real inbox), if set and plausibly an address. */
export function tenantReplyTo(settings: TenantSettings | null | undefined): string | undefined {
  const raw = settings?.marketing_email?.reply_to?.trim();
  if (!raw) return undefined;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) ? raw : undefined;
}
