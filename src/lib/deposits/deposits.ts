// Booking-deposit policy — pure functions only (the Stripe/server side lives
// in checkout.ts). Reads the structured deposit config from settings.venue and
// answers ONE question: does this booking owe a deposit, and how much?
//
// Gate order (all must hold):
//   1. settings.features.deposits_enabled  — the self-serve feature flag
//   2. settings.venue.deposit_required     — the owner's policy switch
//   3. deposit_amount_cents > 0            — a computable amount exists
//   4. party_size >= threshold             — deposit_min_party, falling back to
//      the bot's large-group threshold so "deposit for big groups" works with
//      zero extra config.

import type { TenantSettings } from "@/lib/types/tenant-settings";
import { getFeatures } from "@/lib/types/tenant-settings";
import type { VenueInfo } from "@/lib/onboarding/kb-generator";

export interface DepositDue {
  due: boolean;
  amountCents: number;
  currency: string;
}

export function depositDueFor(
  settings: TenantSettings | null | undefined,
  partySize: number,
): DepositDue {
  const none: DepositDue = { due: false, amountCents: 0, currency: "eur" };
  if (!settings) return none;
  if (!getFeatures(settings).deposits_enabled) return none;

  const venue = (settings.venue || {}) as Partial<VenueInfo>;
  if (!venue.deposit_required) return none;

  const unit = Number(venue.deposit_amount_cents) || 0;
  if (unit <= 0) return none;

  const botLarge = Number(settings.bot_config?.party_size_threshold_large) || 7;
  const threshold = Number(venue.deposit_min_party) || botLarge;
  if (partySize < threshold) return none;

  const amountCents = venue.deposit_policy === "flat" ? unit : unit * partySize;
  const currency = (settings.currency || "EUR").toLowerCase();
  return { due: true, amountCents, currency };
}

/** "25,00 €" — recap/UI formatting for a cents amount. */
export function formatCents(amountCents: number, currency = "eur"): string {
  const symbol = currency.toLowerCase() === "eur" ? "€" : currency.toUpperCase();
  const euros = (amountCents / 100).toFixed(2).replace(".", ",");
  return `${euros} ${symbol}`;
}

/** Localized one-liner for the booking recap when a payable link exists. The
 * guest languages the engine supports (es/it/en/de) — same set as kb-generator. */
export function depositLinkLine(lang: string, amount: string, url: string): string {
  switch ((lang || "es").slice(0, 2)) {
    case "it":
      return `Per confermare il tavolo è richiesta una caparra di ${amount}. Paga qui: ${url}`;
    case "en":
      return `A ${amount} deposit is required to secure the table. Pay here: ${url}`;
    case "de":
      return `Zur Bestätigung des Tisches ist eine Anzahlung von ${amount} erforderlich. Hier zahlen: ${url}`;
    default:
      return `Para confirmar la mesa se requiere un depósito de ${amount}. Paga aquí: ${url}`;
  }
}
