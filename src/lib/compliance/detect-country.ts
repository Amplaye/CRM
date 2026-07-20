// Infer a tenant's compliance country at birth, so the data-protection policy is
// configured automatically instead of waiting for a platform admin to fill the
// form by hand (which, in practice, never happened — every self-signup tenant sat
// with `country` unset, and `getComplianceConfig` therefore reported
// `retentionEnabled: false`, so the retention cron skipped them forever).
//
// WHY ONLY THE PHONE PREFIX. Assigning a country assigns a LEGAL JURISDICTION, so a
// confident-but-wrong guess is worse than an honest "unset": it would hand a Swiss
// venue the GDPR regime (or vice versa) while looking configured. The dialling
// prefix of the venue's own phone number is the one signal in the signup flow that
// is both explicit and owner-supplied. Deliberately NOT used:
//   • `timezone` — defaults to a hardcoded "Europe/Rome"/"Atlantic/Canary" in the
//     wizard, so it's a placeholder, not a declaration of where the venue is.
//   • geo-IP — the person completing onboarding may be an agency, a consultant, or
//     the owner on holiday.
// When the prefix isn't one of our four markets we return null and leave the
// tenant unset, which keeps the existing safe-by-default behaviour (EU-strict
// disclosure ON, retention job inert) rather than inventing a regime.

import type { ComplianceCountry } from "./regions";

/** The markets `REGIONS` supports. Anything else is not a country we can govern. */
const SUPPORTED = new Set<ComplianceCountry>(["ES", "IT", "DE", "CH"]);

/** Dialling prefix → market. Only the four markets `REGIONS` supports. */
const PREFIX_TO_COUNTRY: Array<[string, ComplianceCountry]> = [
  ["34", "ES"],
  ["39", "IT"],
  ["49", "DE"],
  ["41", "CH"],
];

/**
 * Resolve a compliance country from a phone number in international form.
 *
 * Requires an explicit international prefix ("+34…", "0034…", "34…"): a bare
 * national number ("612345678") carries no country information, and guessing one
 * from its length is exactly the confident-but-wrong failure this module exists to
 * avoid. Returns null whenever the market isn't one we support.
 */
export function countryFromPhone(phone: string | null | undefined): ComplianceCountry | null {
  if (!phone) return null;

  // Keep digits only, after normalising the two ways an international call prefix
  // is written ("+34…" and "0034…") to a bare country code.
  const raw = phone.trim();
  const hadPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (!hadPlus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!hadPlus && digits.startsWith("0")) {
    // A single leading zero is a NATIONAL trunk prefix ("06 …" in Italy), not an
    // international one — there's no country in it to read.
    return null;
  }

  for (const [prefix, country] of PREFIX_TO_COUNTRY) {
    if (!digits.startsWith(prefix)) continue;
    // Guard against matching the prefix inside a longer number that is really just
    // a national one: every market here has at least 8 more digits after the code.
    if (digits.length < prefix.length + 8) continue;
    return country;
  }
  return null;
}

/**
 * Validate a country the owner DECLARED (the self-signup dropdown) before it is
 * allowed to set a legal regime.
 *
 * Everything arriving from a form is untrusted: an old client, a tampered body or
 * a market we've since dropped must NOT be written through to
 * `settings.compliance`, because a country we don't have a `RegionConfig` for
 * would make `getComplianceConfig` fall back to the unset defaults while the
 * tenant *looked* configured. Unknown value → null → tenant stays honestly unset.
 */
export function normalizeCountry(value: string | null | undefined): ComplianceCountry | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return SUPPORTED.has(upper as ComplianceCountry) ? (upper as ComplianceCountry) : null;
}

/** Same contract as complianceSettingsForPhone, for a declared country. */
export function complianceSettingsForCountry(
  value: string | null | undefined,
): { country: ComplianceCountry } | null {
  const country = normalizeCountry(value);
  return country ? { country } : null;
}

/**
 * Build the `settings.compliance` object for a newly created tenant.
 *
 * Returns `null` (rather than a partial object) when no country could be
 * determined, so callers can spread it without writing an empty `compliance` key
 * that would look configured while carrying no policy.
 */
export function complianceSettingsForPhone(
  phone: string | null | undefined,
): { country: ComplianceCountry } | null {
  const country = countryFromPhone(phone);
  return country ? { country } : null;
}
