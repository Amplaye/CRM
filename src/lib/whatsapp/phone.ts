// Shared "is this phone deliverable" check, kept in sync with the n8n voice
// Book Logic phone-guard. A guest phone is sendable only if it looks like a
// real E.164 number with a plausible country code — not a placeholder, not a
// mangled STT artefact (e.g. "+6341790137", Philippines prefix + missing digit).

// Obvious placeholders the voice prompt blacklists; duplicated here as a guard.
const PLACEHOLDER_PHONES = new Set([
  "+34600000000",
  "+10000000000",
  "+34000000000",
  "+340000000000",
  "+34000000",
  "+390000000000",
]);

// Country codes we plausibly serve (IT/ES home + common tourist origins).
// Kept identical to the n8n Book Logic allowlist.
const PLAUSIBLE_CC = ["39", "34", "33", "44", "49", "41", "43", "351", "353", "31", "32", "1"];

export function isSendableGuestPhone(phone: string | null | undefined): boolean {
  const p = (phone || "").trim();
  if (!p || !p.startsWith("+")) return false;
  if (PLACEHOLDER_PHONES.has(p)) return false;
  const digits = p.replace(/\D/g, "");
  if (digits.length < 11) return false; // country code + national number
  if (/0{5,}$/.test(digits)) return false; // trailing-zero placeholder
  return PLAUSIBLE_CC.some((cc) => digits.indexOf(cc) === 0);
}
