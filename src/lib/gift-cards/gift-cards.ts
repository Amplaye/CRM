// Gift-card pure logic — code minting and amount rules. Pure module (no
// supabase, no next) so it unit-tests like deposits.ts and imports safely
// from client components, route handlers and the Stripe webhook.

import { randomBytes } from "crypto";

// Pure constants + formatters live in ./format (crypto-free, safe for client
// bundles); re-exported here so existing server imports keep working.
export {
  GIFT_MIN_CENTS,
  GIFT_MAX_CENTS,
  GIFT_PRESETS_CENTS,
  normalizeGiftCode,
  isValidGiftAmount,
  formatGiftCents,
} from "./format";

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


