// Paid pilot → subscription flow for BALI Flow.
//
// The customer pays €150 today for a 14-day pilot. Unless cancelled before day 14,
// a monthly subscription auto-starts on the saved card, and the €150 is credited
// against the FIRST monthly invoice. Two plans:
//
//   plan      pilot today   first invoice (day 14)   then monthly
//   founder   €150          €149  (€299 − €150)       €299
//   premium   €150          €249  (€399 − €150)       €399
//
// Mechanics (see explanation in stripe.ts):
//   1. createPilotCheckout() → Checkout mode=payment: charges €150, saves card,
//      creates customer, collects billing details, shows the consent text.
//   2. activatePilotFromSession() (called by the webhook on checkout.session.completed):
//      creates a 14-day trialing subscription at the FULL monthly price, then applies
//      a −€150 reduction to the first real invoice (customer-balance credit by default,
//      or STRIPE_PILOT_CREDIT_COUPON_ID if set).
//
// The €150 reduction equals the pilot fee for BOTH plans, so NO separate €149/€249
// "first month" prices are needed.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { toOwnerLang, type OwnerLang } from "@/lib/owner-locale";
import {
  stripeConfigured,
  createPilotCheckoutSession,
  retrievePaymentIntent,
  retrieveCheckoutSession,
  updateCustomer,
  createPilotSubscription,
  addCustomerCredit,
  cancelSubscription,
} from "./stripe";

export type PilotPlan = "founder" | "premium";
export type PilotCycle = "monthly" | "annual";

export const PILOT_TRIAL_DAYS = 14;
export const PILOT_FEE_CENTS = 15000;          // €150
export const PILOT_FIRST_MONTH_CREDIT_CENTS = 15000; // €150 — credited to the FIRST
                                                     // invoice, monthly or annual.
export const PILOT_CURRENCY = "eur";

/** Resolve the billing cycle from a request (?cycle=annual|yearly → annual, else monthly). */
export function resolvePilotCycle(req: Request): PilotCycle {
  const c = (new URL(req.url).searchParams.get("cycle") || "").toLowerCase();
  return c === "annual" || c === "yearly" || c === "year" ? "annual" : "monthly";
}

/** Per-plan, per-cycle config. Price ids come from env (never hard-coded). Amounts
 * are kept here only for display; the truth is the Stripe price. The €150 pilot fee
 * is credited to the first invoice in BOTH cycles. */
export const PILOT_PLANS: Record<
  PilotPlan,
  {
    label: string;
    priceEnv: Record<PilotCycle, string>;
    recurringCents: Record<PilotCycle, number>;
  }
> = {
  founder: {
    label: "Founder",
    priceEnv: { monthly: "STRIPE_FOUNDER_MONTHLY_PRICE_ID", annual: "STRIPE_FOUNDER_ANNUAL_PRICE_ID" },
    recurringCents: { monthly: 29900, annual: 299000 }, // €299/mo · €2990/yr
  },
  premium: {
    label: "Premium",
    priceEnv: { monthly: "STRIPE_PREMIUM_MONTHLY_PRICE_ID", annual: "STRIPE_PREMIUM_ANNUAL_PRICE_ID" },
    recurringCents: { monthly: 39900, annual: 399000 }, // €399/mo · €3990/yr
  },
};

/** The pilot terms page, linked from the Checkout consent text and the landing.
 * Override per environment with STRIPE_PILOT_TERMS_URL. */
export const PILOT_TERMS_URL =
  process.env.STRIPE_PILOT_TERMS_URL || "https://restaurants.baliflowagency.com/terminos-piloto";

// Pilot lang = the CRM's supported set (es/it/en/de), default es. The public pilot
// pages have no tenant, so language is resolved from `?lang=` then Accept-Language.
export type PilotLang = OwnerLang;

/** Resolve the page language: explicit ?lang= wins, else the browser's first
 * Accept-Language tag, else Spanish. Both go through toOwnerLang (validates + maps). */
export function resolvePilotLang(req: Request): PilotLang {
  const q = new URL(req.url).searchParams.get("lang");
  if (q) return toOwnerLang(q);
  const al = req.headers.get("accept-language") || "";
  return toOwnerLang(al.split(",")[0]);
}

interface PilotStrings {
  brand: string;
  cycleWord: Record<PilotCycle, string>;
  planName: Record<PilotPlan, string>;
  sub: string;
  todayLabel: string; firstLabel: Record<PilotCycle, string>; afterLabel: string;
  perMonth: string; perYear: string; todayWord: string;
  legal: string; // contains {terms}
  termsLabel: string; businessNameLabel: string;
  payBtn: string; payingBtn: string; errText: string; secureFoot: string;
  resTitle: { success: string; cancel: string };
  resHeading: { success: string; cancel: string };
  resBody: { success: string; cancel: string };
  resCta: string; resFoot: string;
  consent: string; // contains {url}
}

export const PILOT_I18N: Record<PilotLang, PilotStrings> = {
  es: {
    brand: "Piloto · 14 días",
    cycleWord: { monthly: "Mensual", annual: "Anual" },
    planName: { founder: "Plan Fundador", premium: "Plan Premium" },
    sub: "Prueba BALI Flow durante 14 días.",
    todayLabel: "Pago hoy (piloto 14 días)",
    firstLabel: { monthly: "1ª mensualidad (día 14)", annual: "1ª anualidad (día 14)" },
    afterLabel: "Después", perMonth: "/mes", perYear: "/año", todayWord: "hoy",
    legal: "Estás contratando un Piloto de BALI Flow de 14 días por €150. Salvo cancelación antes de que termine el piloto, tu suscripción se activará automáticamente. Los €150 del piloto se descontarán de tu primer pago. Consulta los {terms}.",
    termsLabel: "Términos del piloto", businessNameLabel: "Nombre del negocio (opcional)",
    payBtn: "Pagar €150 y empezar", payingBtn: "Redirigiendo…",
    errText: "No se pudo iniciar el pago. Inténtalo de nuevo.", secureFoot: "Pago seguro con Stripe · BALI Flow",
    resTitle: { success: "¡Pago completado!", cancel: "Pago no completado" },
    resHeading: { success: "Tu Piloto ha comenzado 🎉", cancel: "No se ha completado el pago" },
    resBody: {
      success: "Hemos recibido tu pago de €150 y tu Piloto de BALI Flow de 14 días ya está activo. Durante el piloto no se te cobrará nada más; pasados los 14 días, salvo cancelación, comenzará tu suscripción y los €150 se descontarán de tu primer pago. Recibirás un recibo de Stripe por email y nos pondremos en contacto contigo para la puesta en marcha.",
      cancel: "No se ha realizado ningún cargo. Si ha sido un error, vuelve a abrir el enlace de pago e inténtalo de nuevo. Si necesitas ayuda, escríbenos a info@baliflowagency.com.",
    },
    resCta: "Volver a BALI Flow", resFoot: "BALI Flow · Piloto",
    consent: "Estás contratando un Piloto de BALI Flow de 14 días por €150. Salvo cancelación antes de que termine el piloto, tu suscripción comenzará automáticamente. Los €150 se descontarán de tu primer pago. Términos del piloto: {url}",
  },
  en: {
    brand: "Pilot · 14 days",
    cycleWord: { monthly: "Monthly", annual: "Annual" },
    planName: { founder: "Founder Plan", premium: "Premium Plan" },
    sub: "Try BALI Flow for 14 days.",
    todayLabel: "Today (14-day pilot)",
    firstLabel: { monthly: "1st month (day 14)", annual: "1st year (day 14)" },
    afterLabel: "Then", perMonth: "/mo", perYear: "/yr", todayWord: "today",
    legal: "You are purchasing a 14-day BALI Flow Pilot for €150. Unless cancelled before the pilot ends, your subscription will start automatically. The €150 pilot fee will be credited against your first payment. See the {terms}.",
    termsLabel: "pilot terms", businessNameLabel: "Business name (optional)",
    payBtn: "Pay €150 and start", payingBtn: "Redirecting…",
    errText: "Couldn't start the payment. Please try again.", secureFoot: "Secure payment with Stripe · BALI Flow",
    resTitle: { success: "Payment complete!", cancel: "Payment not completed" },
    resHeading: { success: "Your pilot has started 🎉", cancel: "Payment was not completed" },
    resBody: {
      success: "We've received your €150 payment and your 14-day BALI Flow Pilot is now active. During the pilot you won't be charged anything else; after 14 days, unless cancelled, your subscription begins and the €150 will be credited against your first payment. You'll get a Stripe receipt by email and we'll get in touch to set everything up.",
      cancel: "No charge was made. If this was a mistake, reopen the payment link and try again. Need help? Email info@baliflowagency.com.",
    },
    resCta: "Back to BALI Flow", resFoot: "BALI Flow · Pilot",
    consent: "You are purchasing a 14-day BALI Flow Pilot for €150. Unless cancelled before the pilot ends, your subscription will start automatically. The €150 pilot fee will be credited against your first payment. Pilot terms: {url}",
  },
  it: {
    brand: "Pilota · 14 giorni",
    cycleWord: { monthly: "Mensile", annual: "Annuale" },
    planName: { founder: "Piano Founder", premium: "Piano Premium" },
    sub: "Prova BALI Flow per 14 giorni.",
    todayLabel: "Oggi (pilota 14 giorni)",
    firstLabel: { monthly: "1ª mensilità (giorno 14)", annual: "1ª annualità (giorno 14)" },
    afterLabel: "Poi", perMonth: "/mese", perYear: "/anno", todayWord: "oggi",
    legal: "Stai acquistando un Pilota BALI Flow di 14 giorni per €150. Salvo disdetta prima della fine del pilota, l'abbonamento partirà automaticamente. I €150 del pilota saranno scalati dal tuo primo pagamento. Consulta i {terms}.",
    termsLabel: "Termini del pilota", businessNameLabel: "Nome dell'attività (facoltativo)",
    payBtn: "Paga €150 e inizia", payingBtn: "Reindirizzamento…",
    errText: "Impossibile avviare il pagamento. Riprova.", secureFoot: "Pagamento sicuro con Stripe · BALI Flow",
    resTitle: { success: "Pagamento completato!", cancel: "Pagamento non completato" },
    resHeading: { success: "Il tuo pilota è iniziato 🎉", cancel: "Pagamento non completato" },
    resBody: {
      success: "Abbiamo ricevuto il tuo pagamento di €150 e il tuo Pilota BALI Flow di 14 giorni è ora attivo. Durante il pilota non ti verrà addebitato altro; dopo 14 giorni, salvo disdetta, partirà l'abbonamento e i €150 saranno scalati dal tuo primo pagamento. Riceverai una ricevuta Stripe via email e ti contatteremo per l'attivazione.",
      cancel: "Nessun addebito effettuato. Se è stato un errore, riapri il link di pagamento e riprova. Hai bisogno di aiuto? Scrivi a info@baliflowagency.com.",
    },
    resCta: "Torna a BALI Flow", resFoot: "BALI Flow · Pilota",
    consent: "Stai acquistando un Pilota BALI Flow di 14 giorni per €150. Salvo disdetta prima della fine del pilota, l'abbonamento partirà automaticamente. I €150 saranno scalati dal tuo primo pagamento. Termini del pilota: {url}",
  },
  de: {
    brand: "Pilot · 14 Tage",
    cycleWord: { monthly: "Monatlich", annual: "Jährlich" },
    planName: { founder: "Founder-Tarif", premium: "Premium-Tarif" },
    sub: "Teste BALI Flow 14 Tage lang.",
    todayLabel: "Heute (14-Tage-Pilot)",
    firstLabel: { monthly: "1. Monat (Tag 14)", annual: "1. Jahr (Tag 14)" },
    afterLabel: "Danach", perMonth: "/Monat", perYear: "/Jahr", todayWord: "heute",
    legal: "Du erwirbst einen 14-tägigen BALI-Flow-Pilot für €150. Sofern nicht vor Ende des Pilots gekündigt, startet dein Abonnement automatisch. Die €150 werden auf deine erste Zahlung angerechnet. Siehe die {terms}.",
    termsLabel: "Pilot-Bedingungen", businessNameLabel: "Name des Unternehmens (optional)",
    payBtn: "€150 zahlen und starten", payingBtn: "Weiterleitung…",
    errText: "Zahlung konnte nicht gestartet werden. Bitte erneut versuchen.", secureFoot: "Sichere Zahlung mit Stripe · BALI Flow",
    resTitle: { success: "Zahlung abgeschlossen!", cancel: "Zahlung nicht abgeschlossen" },
    resHeading: { success: "Dein Pilot hat begonnen 🎉", cancel: "Zahlung wurde nicht abgeschlossen" },
    resBody: {
      success: "Wir haben deine Zahlung von €150 erhalten und dein 14-tägiger BALI-Flow-Pilot ist jetzt aktiv. Während des Pilots wird dir nichts weiter berechnet; nach 14 Tagen startet, sofern nicht gekündigt, dein Abonnement und die €150 werden auf deine erste Zahlung angerechnet. Du erhältst eine Stripe-Quittung per E-Mail und wir melden uns zur Einrichtung.",
      cancel: "Es wurde nichts berechnet. War das ein Versehen, öffne den Zahlungslink erneut und versuche es nochmal. Brauchst du Hilfe? Schreib an info@baliflowagency.com.",
    },
    resCta: "Zurück zu BALI Flow", resFoot: "BALI Flow · Pilot",
    consent: "Du erwirbst einen 14-tägigen BALI-Flow-Pilot für €150. Sofern nicht vor Ende des Pilots gekündigt, startet dein Abonnement automatisch. Die €150 werden auf deine erste Zahlung angerechnet. Pilot-Bedingungen: {url}",
  },
};

/** The localized Stripe Checkout consent text (with the terms URL inlined). */
export function pilotConsentText(lang: PilotLang): string {
  return PILOT_I18N[lang].consent.replace("{url}", PILOT_TERMS_URL);
}

/** Shared metadata stamped on every Stripe object for this flow (req 9). */
export function pilotMetadata(plan: PilotPlan, extra?: Record<string, string>): Record<string, string> {
  return {
    product: "BALI Flow",
    flow: "paid_pilot_to_subscription",
    plan,
    pilot_fee: "150",
    first_month_credit: "150",
    ...extra,
  };
}

function taxEnabled(): boolean {
  return process.env.STRIPE_TAX_ENABLED === "true";
}

/** Format whole-euro cents as "€2990". */
function eur(cents: number): string {
  return `€${Math.round(cents / 100)}`;
}

/** Display amounts for a plan+cycle: the recurring price and the discounted first
 * invoice (recurring − €150 pilot credit). */
function pilotAmounts(plan: PilotPlan, cycle: PilotCycle): { first: string; recurring: string } {
  const rec = PILOT_PLANS[plan].recurringCents[cycle];
  return { recurring: eur(rec), first: eur(rec - PILOT_FIRST_MONTH_CREDIT_CENTS) };
}

/** A self-contained, paste-anywhere landing page served on GET, localized to one of
 * the CRM's languages (es/it/en/de). It does NOT create a Checkout Session by itself
 * — that only happens when the visitor clicks the button (a POST to the same URL) —
 * so link-preview bots that fetch the page don't litter Stripe/DB with throwaway
 * sessions. The button reads {url} from the POST JSON and redirects to Stripe. */
export function pilotLandingHtml(plan: PilotPlan, cycle: PilotCycle = "monthly", lang: PilotLang = "es"): string {
  const a = pilotAmounts(plan, cycle);
  const t = PILOT_I18N[lang];
  const title = t.planName[plan];
  const recurringSuffix = cycle === "annual" ? t.perYear : t.perMonth;
  const termsAnchor = `<a href="${PILOT_TERMS_URL}" target="_blank" rel="noopener" style="color:#b8845c;font-weight:600;">${t.termsLabel}</a>`;
  const legalHtml = t.legal.replace("{terms}", termsAnchor);
  // `plan`/`cycle`/`lang` are validated unions; all interpolated copy is from PILOT_I18N.
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>BALI Flow — ${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: 'Geist', ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(to top, #E1CAB2, #ECD7BF, #F4E4CD, #F7EEE0, #FCF6ED) fixed; color:#18181b;
    display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
  .card { background: rgba(252,246,237,0.92); width:100%; max-width:440px; border-radius:18px; padding:32px;
    border:2px solid #c4956a; box-shadow:0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15); }
  .logo { display:block; height:34px; width:auto; margin:0 0 18px; }
  .brand { font-size:12px; letter-spacing:.1em; text-transform:uppercase; color:#b8845c; font-weight:700; margin:0 0 6px; }
  h1 { font-size:24px; margin:0 0 4px; color:#000; }
  .sub { color:#000; font-size:15px; margin:0 0 22px; }
  .price { font-size:44px; font-weight:800; margin:0; color:#000; }
  .price small { font-size:17px; font-weight:600; color:#000; }
  .rows { margin:20px 0; border-top:1px solid rgba(196,149,106,0.30); }
  .row { display:flex; justify-content:space-between; padding:11px 0; border-bottom:1px solid rgba(196,149,106,0.30); font-size:15px; color:#000; }
  .row span:last-child { font-weight:700; color:#000; }
  .legal { background: rgba(196,149,106,0.10); border:1px solid rgba(196,149,106,0.30); border-radius:12px; padding:14px 16px; font-size:13px; color:#000; line-height:1.5; margin:18px 0; }
  button { width:100%; border:0; border-radius:10px; padding:15px; font-size:17px; font-weight:700; color:#fff;
    background:linear-gradient(135deg,#c4956a 0%,#b8845c 100%); cursor:pointer; transition:filter .15s, box-shadow .15s;
    box-shadow:0 4px 14px rgba(196,149,106,0.35); }
  button:hover { filter:brightness(0.96); box-shadow:0 6px 18px rgba(196,149,106,0.45); }
  button:disabled { filter:grayscale(0.4) opacity(0.6); cursor:default; box-shadow:none; }
  .err { color:#b91c1c; font-size:14px; text-align:center; margin-top:12px; min-height:18px; }
  .foot { text-align:center; color:#000; font-size:12px; margin-top:16px; }
</style>
</head>
<body>
  <main class="card">
    <img class="logo" src="/logo-horizontal.png" alt="BALI Flow" />
    <p class="brand">${t.brand} · ${t.cycleWord[cycle]}</p>
    <h1>${title}</h1>
    <p class="sub">${t.sub}</p>
    <p class="price">€150 <small>${t.todayWord}</small></p>
    <div class="rows">
      <div class="row"><span>${t.todayLabel}</span><span>€150</span></div>
      <div class="row"><span>${t.firstLabel[cycle]}</span><span>${a.first}</span></div>
      <div class="row"><span>${t.afterLabel}</span><span>${a.recurring}${recurringSuffix}</span></div>
    </div>
    <div class="legal">${legalHtml}</div>
    <button id="pay" type="button">${t.payBtn}</button>
    <p class="err" id="err"></p>
    <p class="foot">${t.secureFoot}</p>
  </main>
  <script>
    const PAY = ${JSON.stringify(t.payBtn)}, PAYING = ${JSON.stringify(t.payingBtn)}, ERR = ${JSON.stringify(t.errText)};
    const btn = document.getElementById('pay');
    const err = document.getElementById('err');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = PAYING; err.textContent = '';
      try {
        // Preserve ?lang= so the Checkout consent + redirect stay in this language.
        const r = await fetch(window.location.pathname + window.location.search, { method: 'POST', headers: { 'Accept': 'application/json' } });
        const d = await r.json();
        if (d && d.url) { window.location.href = d.url; return; }
        throw new Error('no_url');
      } catch (e) {
        err.textContent = ERR;
        btn.disabled = false; btn.textContent = PAY;
      }
    });
  </script>
</body>
</html>`;
}

/** Post-checkout result page, served on GET at /api/billing/pilot/done, localized to
 * one of the CRM's languages. Stripe redirects here after a successful payment
 * (status=success) or when the buyer abandons (status=cancel). Self-contained, same
 * cream/bronze CRM look, black text — so the customer never lands on the generic
 * /welcome page after paying. */
export function pilotResultHtml(status: "success" | "cancel", lang: PilotLang = "es"): string {
  const ok = status === "success";
  const t = PILOT_I18N[lang];
  const title = t.resTitle[status];
  const heading = t.resHeading[status];
  const body = t.resBody[status];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>BALI Flow — ${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: 'Geist', ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(to top, #E1CAB2, #ECD7BF, #F4E4CD, #F7EEE0, #FCF6ED) fixed; color:#000;
    display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
  .card { background: rgba(252,246,237,0.92); width:100%; max-width:440px; border-radius:18px; padding:32px; text-align:center;
    border:2px solid #c4956a; box-shadow:0 20px 60px rgba(196,149,106,0.25), 0 8px 24px rgba(196,149,106,0.15); }
  .logo { display:block; height:34px; width:auto; margin:0 auto 20px; }
  .mark { font-size:46px; line-height:1; margin:0 0 10px; }
  h1 { font-size:23px; margin:0 0 10px; color:#000; }
  p.msg { color:#000; font-size:15px; line-height:1.6; margin:0 0 22px; }
  a.cta { display:inline-block; text-decoration:none; border-radius:10px; padding:13px 22px; font-size:16px; font-weight:700;
    color:#fff; background:linear-gradient(135deg,#c4956a 0%,#b8845c 100%); box-shadow:0 4px 14px rgba(196,149,106,0.35); }
  .foot { color:#000; font-size:12px; margin-top:18px; }
</style>
</head>
<body>
  <main class="card">
    <img class="logo" src="/logo-horizontal.png" alt="BALI Flow" />
    <div class="mark">${ok ? "✅" : "⚠️"}</div>
    <h1>${heading}</h1>
    <p class="msg">${body}</p>
    <a class="cta" href="https://restaurants.baliflowagency.com">${t.resCta}</a>
    <p class="foot">${t.resFoot}</p>
  </main>
</body>
</html>`;
}

export type PilotCheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; status: number; error: string; reason?: string };

/** Append a query param to a URL string that may already have a query (and may
 * contain Stripe's {CHECKOUT_SESSION_ID} placeholder, which must be left intact). */
function withParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

/** Build the Checkout Session for a pilot plan and record a pending row. Public
 * sales endpoint — no tenant auth (the buyer has no account yet). `cycle` picks the
 * monthly vs annual recurring price; `lang` localizes the consent text, the Stripe
 * Checkout UI, and the success/cancel result pages. The €150 credit is identical in
 * both cycles (it lands on the first invoice, monthly or annual). */
export async function createPilotCheckout(
  plan: PilotPlan,
  cycle: PilotCycle = "monthly",
  origin: string,
  lang: PilotLang = "es",
): Promise<PilotCheckoutResult> {
  if (!stripeConfigured()) {
    return { ok: false, status: 503, error: "not_configured", reason: "stripe_keys_missing" };
  }
  const cfg = PILOT_PLANS[plan];
  const pilotPriceId = process.env.STRIPE_PILOT_PRICE_ID;
  const recurringPriceId = process.env[cfg.priceEnv[cycle]];
  if (!pilotPriceId || !recurringPriceId) {
    return { ok: false, status: 503, error: "not_configured", reason: "stripe_price_missing" };
  }

  // The result page reads ?lang= to stay in the buyer's language after redirect.
  const successUrl = withParam(
    process.env.FRONTEND_SUCCESS_URL || `${origin}/api/billing/pilot/done?status=success&session_id={CHECKOUT_SESSION_ID}`,
    "lang",
    lang,
  );
  const cancelUrl = withParam(
    process.env.FRONTEND_CANCEL_URL || `${origin}/api/billing/pilot/done?status=cancel`,
    "lang",
    lang,
  );

  const metadata = pilotMetadata(plan, { lang, cycle });

  let session: { id: string; url: string };
  try {
    session = await createPilotCheckoutSession({
      pilotPriceId,
      successUrl,
      cancelUrl,
      locale: lang,
      consentMessage: pilotConsentText(lang),
      metadata,
      taxEnabled: taxEnabled(),
      requireTos: process.env.STRIPE_REQUIRE_TOS === "true",
      businessNameLabel: PILOT_I18N[lang].businessNameLabel,
    });
  } catch (e) {
    return { ok: false, status: 502, error: "stripe_error", reason: (e as Error)?.message };
  }

  // Record a pending row so an abandoned checkout is still visible, and so the
  // webhook upsert has a stable key (the session id).
  try {
    const svc = createServiceRoleClient();
    await svc.from("pilot_subscriptions").upsert(
      {
        plan,
        stripe_checkout_session_id: session.id,
        pilot_fee_cents: PILOT_FEE_CENTS,
        first_month_credit_cents: PILOT_FIRST_MONTH_CREDIT_CENTS,
        subscription_status: "incomplete",
        payment_status: "pending",
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_checkout_session_id" },
    );
  } catch (e) {
    // Non-fatal: the webhook re-upserts by session id. Log and continue.
    console.error("[pilot] failed to record pending row", { sessionId: session.id, error: e });
  }

  return { ok: true, url: session.url, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Webhook side
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any;

/** Idempotently activate the pilot subscription from a completed Checkout Session.
 * Safe to call multiple times (Stripe re-delivers webhooks): if the row already
 * has a subscription id, it's a no-op. */
export async function activatePilotFromSession(svc: Svc, sessionObj: Record<string, any>): Promise<void> {
  const sessionId = String(sessionObj.id);
  const plan = (sessionObj.metadata?.plan as PilotPlan) || undefined;
  if (plan !== "founder" && plan !== "premium") return; // not a pilot session

  // Has this session already been activated? (webhook retry) → skip sub creation.
  const { data: existing } = await svc
    .from("pilot_subscriptions")
    .select("id, stripe_subscription_id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (existing?.stripe_subscription_id) return;

  const customerId: string | undefined =
    typeof sessionObj.customer === "string" ? sessionObj.customer : sessionObj.customer?.id;
  if (!customerId) throw new Error("checkout session has no customer");

  // Resolve the saved payment method from the one-time PaymentIntent.
  let paymentMethod: string | undefined;
  const piRef = sessionObj.payment_intent;
  if (piRef) {
    const pi = await retrievePaymentIntent(typeof piRef === "string" ? piRef : String(piRef.id));
    paymentMethod = typeof pi.payment_method === "string" ? pi.payment_method : undefined;
  }

  // The billing cycle was stamped on the session metadata at checkout creation.
  const cycle: PilotCycle = sessionObj.metadata?.cycle === "annual" ? "annual" : "monthly";
  const cfg = PILOT_PLANS[plan];
  const recurringPriceId = process.env[cfg.priceEnv[cycle]];
  if (!recurringPriceId) throw new Error(`${cfg.priceEnv[cycle]} not set`);
  const metadata = pilotMetadata(plan, { stripe_checkout_session_id: sessionId, cycle });

  // Make the saved card the customer default + stamp metadata.
  await updateCustomer(customerId, { defaultPaymentMethod: paymentMethod, metadata });

  // Create the 14-day trialing subscription at the FULL recurring price (monthly or annual).
  const couponId = process.env.STRIPE_PILOT_CREDIT_COUPON_ID || undefined;
  const sub = await createPilotSubscription({
    customerId,
    monthlyPriceId: recurringPriceId, // param name is generic; carries the cycle's price
    trialPeriodDays: PILOT_TRIAL_DAYS,
    defaultPaymentMethod: paymentMethod,
    couponId,
    taxEnabled: taxEnabled(),
    metadata,
    idempotencyKey: `pilot_sub_${sessionId}`,
  });

  // Apply the €150 reduction to the FIRST real invoice (monthly or annual). Coupon
  // (if configured) is already attached above; otherwise use a customer-balance credit.
  if (!couponId) {
    await addCustomerCredit(
      customerId,
      -PILOT_FIRST_MONTH_CREDIT_CENTS,
      PILOT_CURRENCY,
      "BALI Flow pilot fee credited to first payment",
      metadata,
      `pilot_credit_${sessionId}`,
    );
  }

  // Read collected billing details from the session.
  const details = sessionObj.customer_details || {};
  const businessName = (sessionObj.custom_fields || []).find(
    (f: any) => f.key === "business_name",
  )?.text?.value;
  const taxId = Array.isArray(details.tax_ids) && details.tax_ids[0]?.value ? details.tax_ids[0].value : null;

  const trialStart = sub.trial_start ? new Date(Number(sub.trial_start) * 1000).toISOString() : null;
  const trialEnd = sub.trial_end ? new Date(Number(sub.trial_end) * 1000).toISOString() : null;

  await svc.from("pilot_subscriptions").upsert(
    {
      plan,
      stripe_checkout_session_id: sessionId,
      stripe_customer_id: customerId,
      stripe_subscription_id: String(sub.id),
      customer_email: details.email || sessionObj.customer_email || null,
      customer_name: details.name || null,
      business_name: businessName || null,
      tax_id: taxId,
      pilot_fee_cents: PILOT_FEE_CENTS,
      first_month_credit_cents: PILOT_FIRST_MONTH_CREDIT_CENTS,
      pilot_start: trialStart,
      pilot_end: trialEnd,
      subscription_status: mapStripeSubStatus(String(sub.status)),
      payment_status: "paid", // the €150 pilot fee is captured at checkout
      metadata,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_checkout_session_id" },
  );
}

/** Find a pilot row by Stripe subscription or customer id. */
export async function findPilotByStripe(
  svc: Svc,
  subscriptionId?: string,
  customerId?: string,
): Promise<{ id: string; stripe_subscription_id: string | null; stripe_customer_id: string | null } | null> {
  if (subscriptionId) {
    const { data } = await svc
      .from("pilot_subscriptions")
      .select("id, stripe_subscription_id, stripe_customer_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (data) return data;
  }
  if (customerId) {
    const { data } = await svc
      .from("pilot_subscriptions")
      .select("id, stripe_subscription_id, stripe_customer_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

/** Patch a pilot row found by Stripe ids. No-op if no matching pilot row (the
 * event belongs to the other, non-pilot billing flow). */
export async function patchPilotByStripe(
  svc: Svc,
  ids: { subscriptionId?: string; customerId?: string },
  patch: Record<string, unknown>,
): Promise<void> {
  const row = await findPilotByStripe(svc, ids.subscriptionId, ids.customerId);
  if (!row) return;
  await svc
    .from("pilot_subscriptions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", row.id);
}

export function mapStripeSubStatus(s: string): "incomplete" | "trialing" | "active" | "past_due" | "canceled" {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      return "incomplete";
  }
}

// ---------------------------------------------------------------------------
// Cancellation (admin / internal)
// ---------------------------------------------------------------------------

export type PilotCancelResult =
  | { ok: true; subscriptionId: string }
  | { ok: false; error: string };

/** Cancel a pilot subscription IMMEDIATELY so the first subscription invoice is
 * never charged. Callable internally (admin route, script). Looks the pilot up by
 * subscription id, customer id, OR session id, cancels in Stripe, and records it.
 * The €150 pilot fee is non-refundable and is NOT touched here. */
export async function cancelPilotSubscription(opts: {
  subscriptionId?: string;
  customerId?: string;
  sessionId?: string;
}): Promise<PilotCancelResult> {
  if (!stripeConfigured()) return { ok: false, error: "stripe_not_configured" };
  const svc = createServiceRoleClient();

  let query = svc.from("pilot_subscriptions").select("id, stripe_subscription_id");
  if (opts.subscriptionId) query = query.eq("stripe_subscription_id", opts.subscriptionId);
  else if (opts.customerId) query = query.eq("stripe_customer_id", opts.customerId);
  else if (opts.sessionId) query = query.eq("stripe_checkout_session_id", opts.sessionId);
  else return { ok: false, error: "no_identifier" };

  const { data: row } = await query.maybeSingle();
  if (!row?.stripe_subscription_id) return { ok: false, error: "pilot_not_found" };

  try {
    await cancelSubscription(row.stripe_subscription_id);
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "stripe_cancel_failed" };
  }

  await svc
    .from("pilot_subscriptions")
    .update({
      canceled: true,
      canceled_at: new Date().toISOString(),
      subscription_status: "canceled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return { ok: true, subscriptionId: row.stripe_subscription_id };
}

export { retrieveCheckoutSession };
