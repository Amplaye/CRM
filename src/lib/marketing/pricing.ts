// Campaign cost estimation (pure, no I/O — vitest-friendly, same idiom as
// segmentation.ts). The marketing UI shows the owner "this send will cost ~X"
// BEFORE they hit send, so a 300-recipient WhatsApp blast is never a surprise
// on the Meta invoice.
//
// Two cost models:
//   • WhatsApp → Meta bills per MARKETING conversation, priced by the
//     RECIPIENT's country (E.164 prefix). Rates below are Meta's published
//     marketing-category prices (EUR), rounded, 2024/25 tiers. They drift, so
//     they live in ONE table here — update this file when Meta revises pricing.
//   • Email → Resend bills per email (~€0.0004 at the 50k tier). Negligible per
//     send but shown for honesty.
//
// This is an ESTIMATE for the owner's eyes, not a billing source of truth —
// the real charge is whatever Meta/Resend invoice. We deliberately round up so
// the shown number is a ceiling, never an under-promise.

/** Meta marketing-conversation price (EUR) by country calling-code prefix.
 * Longest-prefix match wins, so "1" (US/CA) and "1876" (Jamaica) can differ. */
const WA_MARKETING_EUR: Record<string, number> = {
  "34": 0.0592, // Spain
  "39": 0.0691, // Italy
  "49": 0.1365, // Germany
  "44": 0.0705, // UK
  "33": 0.0672, // France
  "351": 0.038, // Portugal
  "1": 0.0146, // US / Canada
  "52": 0.0436, // Mexico
  "55": 0.0625, // Brazil
  "62": 0.0403, // Indonesia
};

/** Fallback when the recipient's country isn't in the table (unknown/rare). */
const WA_MARKETING_EUR_DEFAULT = 0.08;

/** Resend per-email cost (EUR), used only to show email isn't free either. */
export const EMAIL_EUR_PER_SEND = 0.0004;

/** Digits only, no leading '+'. Returns the marketing price for that number. */
export function whatsappPriceForPhone(phone: string): number {
  const digits = (phone || "").replace(/[^\d]/g, "");
  if (!digits) return WA_MARKETING_EUR_DEFAULT;
  // Longest matching prefix wins.
  let best = WA_MARKETING_EUR_DEFAULT;
  let bestLen = 0;
  for (const [prefix, price] of Object.entries(WA_MARKETING_EUR)) {
    if (digits.startsWith(prefix) && prefix.length > bestLen) {
      best = price;
      bestLen = prefix.length;
    }
  }
  return best;
}

export interface CostEstimate {
  /** How many messages will actually be attempted (has-contact recipients). */
  billable: number;
  /** Estimated total cost in EUR, rounded up to the cent. */
  total_eur: number;
  /** Per-message cost when uniform (e.g. all same country); null if mixed. */
  per_message_eur: number | null;
}

/** Estimate the cost of a WhatsApp campaign to a set of phone numbers. */
export function estimateWhatsAppCost(phones: string[]): CostEstimate {
  const billable = phones.length;
  if (!billable) return { billable: 0, total_eur: 0, per_message_eur: 0 };
  let sum = 0;
  const prices = new Set<number>();
  for (const p of phones) {
    const price = whatsappPriceForPhone(p);
    sum += price;
    prices.add(price);
  }
  return {
    billable,
    total_eur: Math.ceil(sum * 100) / 100,
    per_message_eur: prices.size === 1 ? [...prices][0] : null,
  };
}

/** Estimate the cost of an email campaign (count × flat per-send). */
export function estimateEmailCost(count: number): CostEstimate {
  return {
    billable: count,
    total_eur: Math.ceil(count * EMAIL_EUR_PER_SEND * 100) / 100,
    per_message_eur: EMAIL_EUR_PER_SEND,
  };
}
