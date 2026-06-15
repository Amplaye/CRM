import { describe, it, expect } from "vitest";
import {
  PILOT_PLANS,
  PILOT_FEE_CENTS,
  PILOT_FIRST_MONTH_CREDIT_CENTS,
  PILOT_TRIAL_DAYS,
  PILOT_I18N,
  PILOT_TERMS_URL,
  pilotMetadata,
  pilotConsentText,
  pilotLandingHtml,
  pilotResultHtml,
  resolvePilotLang,
  mapStripeSubStatus,
  type PilotLang,
} from "./pilot";

const LANGS: PilotLang[] = ["es", "it", "en", "de"];

// These guard the MONEY model and metadata contract — the parts that, if wrong,
// would over/under-charge a customer. The Stripe wiring itself is covered by the
// test-mode checklist (network-dependent, not a unit test).

describe("pilot money model", () => {
  it("charges €150 today and credits €150 to the first month for both plans", () => {
    expect(PILOT_FEE_CENTS).toBe(15000);
    expect(PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(15000);
    expect(PILOT_TRIAL_DAYS).toBe(14);
  });

  it("founder: €299/mo, first invoice €149 (= monthly − €150)", () => {
    const f = PILOT_PLANS.founder;
    expect(f.monthlyCents).toBe(29900);
    expect(f.firstInvoiceCents).toBe(14900);
    expect(f.monthlyCents - PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(f.firstInvoiceCents);
    expect(f.monthlyPriceEnv).toBe("STRIPE_FOUNDER_MONTHLY_PRICE_ID");
  });

  it("premium: €399/mo, first invoice €249 (= monthly − €150)", () => {
    const p = PILOT_PLANS.premium;
    expect(p.monthlyCents).toBe(39900);
    expect(p.firstInvoiceCents).toBe(24900);
    expect(p.monthlyCents - PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(p.firstInvoiceCents);
    expect(p.monthlyPriceEnv).toBe("STRIPE_PREMIUM_MONTHLY_PRICE_ID");
  });

  it("the first-month credit never makes today's charge €0 (req 14)", () => {
    // Today's fee is independent of the credit; both are €150, applied to different
    // moments (today vs first invoice), never netted against each other.
    expect(PILOT_FEE_CENTS).toBeGreaterThan(0);
  });
});

describe("pilot metadata (req 9)", () => {
  it("stamps the required keys on every object", () => {
    const m = pilotMetadata("founder");
    expect(m).toMatchObject({
      product: "BALI Flow",
      flow: "paid_pilot_to_subscription",
      plan: "founder",
      pilot_fee: "150",
      first_month_credit: "150",
    });
  });

  it("merges extra keys", () => {
    expect(pilotMetadata("premium", { stripe_checkout_session_id: "cs_x" })).toMatchObject({
      plan: "premium",
      stripe_checkout_session_id: "cs_x",
    });
  });
});

describe("pilot i18n (es/it/en/de)", () => {
  it("has complete strings for every supported language", () => {
    for (const lang of LANGS) {
      const t = PILOT_I18N[lang];
      expect(t.payBtn, lang).toBeTruthy();
      expect(t.sub, lang).toBeTruthy();
      expect(t.planName.founder, lang).toBeTruthy();
      expect(t.planName.premium, lang).toBeTruthy();
      expect(t.resBody.success, lang).toBeTruthy();
      expect(t.resBody.cancel, lang).toBeTruthy();
      expect(t.legal, lang).toContain("{terms}");
      expect(t.consent, lang).toContain("{url}");
    }
  });

  it("consent text inlines the terms URL (no leftover placeholder)", () => {
    for (const lang of LANGS) {
      const c = pilotConsentText(lang);
      expect(c, lang).toContain(PILOT_TERMS_URL);
      expect(c, lang).not.toContain("{url}");
    }
  });

  it("landing renders translated copy + correct amounts per language", () => {
    const html = pilotLandingHtml("founder", "it");
    expect(html).toContain('<html lang="it">');
    expect(html).toContain("Paga €150 e inizia");
    expect(html).toContain("Piano Founder");
    expect(html).toContain("€299/mese");
    expect(html).not.toContain("{terms}"); // placeholder resolved to an <a>
    expect(html).toContain(PILOT_TERMS_URL);
  });

  it("result page renders translated success/cancel per language", () => {
    expect(pilotResultHtml("success", "de")).toContain("Dein Pilot hat begonnen");
    expect(pilotResultHtml("cancel", "en")).toContain("Payment was not completed");
    expect(pilotResultHtml("success", "es")).toContain('<html lang="es">');
  });

  it("resolvePilotLang: ?lang= wins, else Accept-Language, else es", () => {
    const mk = (url: string, accept?: string) =>
      new Request(url, accept ? { headers: { "accept-language": accept } } : undefined);
    expect(resolvePilotLang(mk("https://x/p?lang=de"))).toBe("de");
    expect(resolvePilotLang(mk("https://x/p?lang=fr"))).toBe("es"); // unsupported → default
    expect(resolvePilotLang(mk("https://x/p", "it-IT,it;q=0.9,en;q=0.8"))).toBe("it");
    expect(resolvePilotLang(mk("https://x/p", "pt-BR"))).toBe("es"); // unsupported → default
    expect(resolvePilotLang(mk("https://x/p"))).toBe("es"); // nothing → default
    // explicit lang overrides the header
    expect(resolvePilotLang(mk("https://x/p?lang=en", "de-DE"))).toBe("en");
  });
});

describe("mapStripeSubStatus", () => {
  it("maps Stripe statuses to our enum", () => {
    expect(mapStripeSubStatus("trialing")).toBe("trialing");
    expect(mapStripeSubStatus("active")).toBe("active");
    expect(mapStripeSubStatus("past_due")).toBe("past_due");
    expect(mapStripeSubStatus("unpaid")).toBe("past_due");
    expect(mapStripeSubStatus("canceled")).toBe("canceled");
    expect(mapStripeSubStatus("incomplete_expired")).toBe("incomplete");
  });
});
