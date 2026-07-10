import { describe, expect, it } from "vitest";
import { depositDueFor, formatCents, depositLinkLine } from "./deposits";
import type { TenantSettings } from "@/lib/types/tenant-settings";

const base = (over: Partial<TenantSettings> = {}): TenantSettings => ({
  features: { deposits_enabled: true },
  venue: {
    deposit_required: true,
    deposit_amount: "10€ a persona",
    deposit_amount_cents: 1000,
    deposit_policy: "per_person",
  },
  bot_config: { party_size_threshold_large: 7 },
  ...over,
});

describe("depositDueFor", () => {
  it("charges per person from the large-group threshold", () => {
    expect(depositDueFor(base(), 8)).toEqual({ due: true, amountCents: 8000, currency: "eur" });
    expect(depositDueFor(base(), 6).due).toBe(false); // below bot threshold 7
  });

  it("flat policy charges once regardless of party size", () => {
    const s = base();
    (s.venue as Record<string, unknown>).deposit_policy = "flat";
    expect(depositDueFor(s, 10)).toEqual({ due: true, amountCents: 1000, currency: "eur" });
  });

  it("deposit_min_party overrides the bot threshold; 1 = always", () => {
    const s = base();
    (s.venue as Record<string, unknown>).deposit_min_party = 1;
    expect(depositDueFor(s, 2).due).toBe(true);
    (s.venue as Record<string, unknown>).deposit_min_party = 12;
    expect(depositDueFor(s, 10).due).toBe(false);
  });

  it("every gate can veto: flag off, policy off, no amount, no settings", () => {
    expect(depositDueFor(null, 10).due).toBe(false);
    expect(depositDueFor(base({ features: { deposits_enabled: false } }), 10).due).toBe(false);
    const noPolicy = base();
    (noPolicy.venue as Record<string, unknown>).deposit_required = false;
    expect(depositDueFor(noPolicy, 10).due).toBe(false);
    const noAmount = base();
    (noAmount.venue as Record<string, unknown>).deposit_amount_cents = 0;
    expect(depositDueFor(noAmount, 10).due).toBe(false);
  });

  it("respects tenant currency", () => {
    expect(depositDueFor(base({ currency: "CHF" }), 8).currency).toBe("chf");
  });
});

describe("formatCents / depositLinkLine", () => {
  it("formats euros with comma decimals", () => {
    expect(formatCents(8000)).toBe("80,00 €");
    expect(formatCents(1550, "chf")).toBe("15,50 CHF");
  });

  it("localizes the recap line in the 4 guest languages", () => {
    const url = "https://checkout.stripe.com/x";
    expect(depositLinkLine("it", "80,00 €", url)).toContain("caparra di 80,00 €");
    expect(depositLinkLine("es", "80,00 €", url)).toContain("depósito de 80,00 €");
    expect(depositLinkLine("en", "80,00 €", url)).toContain("80,00 € deposit");
    expect(depositLinkLine("de", "80,00 €", url)).toContain("Anzahlung von 80,00 €");
    expect(depositLinkLine("fr", "80,00 €", url)).toContain("depósito"); // unknown → es
  });
});
