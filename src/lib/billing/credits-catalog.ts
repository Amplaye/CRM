// Credits catalog — the single source of truth for what an action COSTS the
// tenant and what a credit costs us. Pure data + pure functions: no I/O, no
// Supabase, so both the server (metering) and the client (badge, price table)
// import it, and the number the customer reads is provably the number we debit.
//
// UNIT: 1 credit = €0.20 (sale price). Our live cost per action is ~1/3 of that
// — the markup is deliberate and lives in the gap between `costEur` (what we pay
// Meta/OpenAI/Vapi) and the credit price (what they pay us).
//
// MILLICREDITS: everything is stored and computed in integers, 1 credit =
// 1000 mc. A bot message is 0.04 credits — as a float, debited a few hundred
// thousand times, that quietly drifts. As 40 mc, it cannot. Floats appear
// exactly once in this file, in toCredits(), on the way to the screen.

export type CreditAction =
  | "bot_message"
  | "marketing_whatsapp"
  | "marketing_email"
  | "voice_minute"
  | "invoice_ocr"
  | "menu_import"
  | "transcription"
  | "ai_text";

/** Millicredits per credit. */
export const MC_PER_CREDIT = 1000;

/** Sale price of one credit, EUR. */
export const EUR_PER_CREDIT = 0.2;

/**
 * Cost of each metered action, in MILLICREDITS (integers — never floats).
 *
 * The live-cost column is what WE pay, and it's why each number is what it is:
 *   bot_message         ~€0.008  (OpenAI turn + Meta service conversation)
 *   marketing_whatsapp  €0.06–0.14 per recipient (Meta, priced by country)
 *   marketing_email     €0.0004  (Resend)
 *   voice_minute        ~€0.09   (Vapi/Retell + STT/TTS)
 *   invoice_ocr         ~€0.03   (gpt-4o vision, one invoice)
 *   menu_import         ~€0.05   (gpt-4o vision, per 4-page chunk)
 *   transcription       ~€0.003  (Whisper, one voice note)
 *   ai_text             ~€0.01   (one generation: campaign copy, review reply, summary)
 */
export const ACTION_MC: Record<CreditAction, number> = {
  bot_message: 40, // 0.04 cr → ~25 messages per credit
  marketing_whatsapp: 400, // 0.4 cr per recipient
  marketing_email: 10, // 0.01 cr
  voice_minute: 500, // 0.5 cr
  invoice_ocr: 200, // 0.2 cr
  menu_import: 400, // 0.4 cr per chunk
  transcription: 20, // 0.02 cr
  ai_text: 50, // 0.05 cr
};

/**
 * Monthly allowance included in each plan, in millicredits. Resets at every
 * renewal (use-it-or-lose-it) — see grant_credits(kind => 'included').
 *
 * Premium €399 → 2.000 cr = €400 of credit at list price, ≈€40 of live cost:
 * ~10% of the revenue, which is the ceiling we're buying with this whole system.
 * A typical restaurant burns 300–600.
 */
export const PLAN_CREDITS_MC: Record<"premium" | "business", number> = {
  premium: 2_000_000, // 2.000 cr
  business: 1_250_000, // 1.250 cr
};

/** One-off top-up packs (Stripe `mode: "payment"`). Bought credits never expire.
 * Bigger packs are cheaper per credit — the discount is the incentive to top up
 * once instead of five times. */
export const CREDIT_PACKS = [
  { id: "credits_500", creditsMc: 500_000, amount: 19 },
  { id: "credits_1500", creditsMc: 1_500_000, amount: 49 },
  { id: "credits_5000", creditsMc: 5_000_000, amount: 149 },
] as const;

export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"];

export function getCreditPack(id: string) {
  return CREDIT_PACKS.find((p) => p.id === id);
}

/** Millicredits for `qty` units of an action (recipients, minutes, chunks). The
 * ONLY place credit arithmetic happens — callers never multiply by hand. */
export function mcFor(action: CreditAction, qty = 1): number {
  const n = Math.max(0, Math.ceil(qty));
  return ACTION_MC[action] * n;
}

/** Millicredits → credits (the one float in the file; display only). */
export function toCredits(mc: number): number {
  return mc / MC_PER_CREDIT;
}

/**
 * The ONE place that decides how a credit amount is written on screen, so the
 * badge and the price table can never disagree.
 *
 * Under 10 credits → 2 decimals ("0,04"), because that's the resolution at which
 * single actions are priced and rounding a bot message to "0" would read as free.
 * From 10 up → whole credits with a thousands separator ("1.847"): nobody wants
 * to read their balance as "1.846,96". European formatting (it/es/de), matching
 * the rest of the CRM.
 */
export function formatCredits(mc: number): string {
  const credits = toCredits(mc);
  const abs = Math.abs(credits);
  if (abs < 10) {
    return credits.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // useGrouping: "always" is load-bearing. es-ES defaults to "min2", which omits
  // the separator on 4-digit numbers: a 1.847-credit balance would render as
  // "1847" while a 12.500-credit one renders as "12.500". Same screen, two
  // conventions — so force the separator on.
  return Math.round(credits).toLocaleString("es-ES", { useGrouping: "always" });
}

/** EUR value of a millicredit amount, at list price. */
export function creditsToEur(mc: number): number {
  return toCredits(mc) * EUR_PER_CREDIT;
}

/** Stripe price id for a top-up pack. Same env convention as
 * resolveStripePriceId in catalog.ts: STRIPE_PRICE_CREDITS_500 / _1500 / _5000. */
export function resolveCreditPackPriceId(id: CreditPackId): string | undefined {
  const suffix = id.replace("credits_", "");
  return process.env[`STRIPE_PRICE_CREDITS_${suffix}`] || undefined;
}
