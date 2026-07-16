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

  it("founder: monthly €299 (first €149) / annual €2990 (first €2840)", () => {
    const f = PILOT_PLANS.founder;
    expect(f.recurringCents.monthly).toBe(29900);
    expect(f.recurringCents.annual).toBe(299000);
    expect(f.recurringCents.monthly - PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(14900);
    expect(f.recurringCents.annual - PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(284000);
    expect(f.priceEnv.monthly).toBe("STRIPE_FOUNDER_MONTHLY_PRICE_ID");
    expect(f.priceEnv.annual).toBe("STRIPE_FOUNDER_ANNUAL_PRICE_ID");
  });

  it("premium: monthly €399 (first €249) / annual €3990 (first €3840)", () => {
    const p = PILOT_PLANS.premium;
    expect(p.recurringCents.monthly).toBe(39900);
    expect(p.recurringCents.annual).toBe(399000);
    expect(p.recurringCents.monthly - PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(24900);
    expect(p.recurringCents.annual - PILOT_FIRST_MONTH_CREDIT_CENTS).toBe(384000);
    expect(p.priceEnv.monthly).toBe("STRIPE_PREMIUM_MONTHLY_PRICE_ID");
    expect(p.priceEnv.annual).toBe("STRIPE_PREMIUM_ANNUAL_PRICE_ID");
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
      // per-cycle strings present for both monthly and annual
      expect(t.firstLabel.monthly, lang).toBeTruthy();
      expect(t.firstLabel.annual, lang).toBeTruthy();
      expect(t.cycleWord.monthly, lang).toBeTruthy();
      expect(t.cycleWord.annual, lang).toBeTruthy();
      expect(t.perMonth, lang).toBeTruthy();
      expect(t.perYear, lang).toBeTruthy();
      // consent/legal must be cycle-neutral (no "monthly"-specific wording)
      expect(t.consent.toLowerCase(), lang).not.toMatch(/mensual|mensilità|monatsrechnung|monthly payment/);
    }
  });

  it("consent text inlines the terms URL (no leftover placeholder)", () => {
    for (const lang of LANGS) {
      const c = pilotConsentText(lang);
      expect(c, lang).toContain(PILOT_TERMS_URL);
      expect(c, lang).not.toContain("{url}");
    }
  });

  it("landing renders translated copy + correct amounts per language (monthly)", () => {
    const html = pilotLandingHtml("founder", "monthly", "it");
    expect(html).toContain('<html lang="it">');
    expect(html).toContain("Paga €150 e inizia");
    expect(html).toContain("Piano Founder");
    expect(html).toContain("€299/mese");
    expect(html).toContain("€149"); // first month = 299 − 150
    expect(html).not.toContain("{terms}"); // placeholder resolved to an <a>
    expect(html).toContain(PILOT_TERMS_URL);
  });

  it("landing renders the ANNUAL cycle (amounts, suffix, cycle word)", () => {
    const es = pilotLandingHtml("premium", "annual", "es");
    expect(es).toContain("€3990/año");      // annual recurring
    expect(es).toContain("€3840");          // first year = 3990 − 150
    expect(es).toContain("Anual");          // cycle badge
    expect(es).toContain("1ª anualidad (día 14)");
    const en = pilotLandingHtml("founder", "annual", "en");
    expect(en).toContain("€2990/yr");
    expect(en).toContain("€2840");
    expect(en).toContain("Annual");
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
