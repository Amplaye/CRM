// Gift-card pure logic — code minting and amount rules. Pure module (no
// supabase, no next) so it unit-tests like deposits.ts and imports safely
// from client components, route handlers and the Stripe webhook.

import { randomBytes } from "crypto";

/** Purchase bounds (cents): keep a public form from minting a 1-cent or a
 * 5000-euro voucher. Presets the /g/<slug> page offers live here too so the
 * form and the server validate the SAME numbers. */
export const GIFT_MIN_CENTS = 1000; // €10
export const GIFT_MAX_CENTS = 50000; // €500
export const GIFT_PRESETS_CENTS = [2500, 5000, 7500, 10000] as const;

/** Code alphabet without ambiguous glyphs (0/O, 1/I/L) — a waiter will TYPE
 * this at the till, often read aloud from a phone screen. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Mint a human-typable voucher code like "GIFT-7K2M-Q4XA". ~1e12 space on 8
 * random chars — collisions are handled by the caller retrying on the DB
 * unique constraint, not by making the code longer. */
export function generateGiftCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `GIFT-${s.slice(0, 4)}-${s.slice(4)}`;
}

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
