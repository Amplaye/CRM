// Gift-card pure constants + formatters — split from gift-cards.ts so client
// components (public /g form, previews, editor) can import them without
// dragging the crypto code-minting into the browser bundle (the crypto
// polyfill uses eval, which our CSP forbids). gift-cards.ts re-exports
// everything here, so server code keeps importing from "./gift-cards".

/** Purchase bounds (cents): keep a public form from minting a 1-cent or a
 * 5000-euro voucher. Presets the /g/<slug> page offers live here too so the
 * form and the server validate the SAME numbers. */
export const GIFT_MIN_CENTS = 1000; // €10
export const GIFT_MAX_CENTS = 50000; // €500
export const GIFT_PRESETS_CENTS = [2500, 5000, 7500, 10000] as const;

/** Uppercase, strip spaces/dashes typos: "gift 7k2m q4xa" → "GIFT-7K2M-Q4XA".
 * Returns null when the result doesn't look like a voucher code at all. */
export function normalizeGiftCode(raw: string): string | null {
  const compact = (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^GIFT[A-Z0-9]{8}$/.test(compact)) return null;
  const body = compact.slice(4);
  return `GIFT-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** Validate a purchase amount in cents against the public-form bounds. */
export function isValidGiftAmount(cents: number): boolean {
  return Number.isInteger(cents) && cents >= GIFT_MIN_CENTS && cents <= GIFT_MAX_CENTS;
}

export function formatGiftCents(cents: number, currency = "EUR"): string {
  const symbol = currency.toUpperCase() === "EUR" ? "€" : currency.toUpperCase();
  const whole = cents / 100;
  return `${Number.isInteger(whole) ? whole : whole.toFixed(2)} ${symbol}`;
}
