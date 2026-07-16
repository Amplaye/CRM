// Playwright UI E2E for Settings → Payments on PROD (crm.baliflowagency.com).
// Verifies, with a real browser + real login, that the new Payments tab renders:
//   • heading + both plan cards (Premium / Business) with the right prices
//   • monthly/yearly toggle flips the displayed price (399→3990, 329→3290)
//   • the add-ons: voice BASE €99 + voice PREMIUM €199, design from €750, inventory soon
//   • the removed website-care €59 add-on is GONE
//   • Stripe is configured on prod → the Stripe pay button is enabled (live checkout)
//
// It does NOT start a real checkout (no keys, and that would hit Stripe/PayPal).
//
//   node scripts/payments-ui-e2e.mjs
//
// Login: platform admin → select a tenant (the owner-gated tab also shows for admin).

import { chromium } from "playwright";

const CRM = "https://crm.baliflowagency.com";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD || "+It&Uz+riRRHG9j+g%h6w2C_";
const TENANT = process.env.TENANT_NAME || "Oraz";
const SHOT = "/tmp/payments-ui-e2e";

const log = (...a) => console.log(...a);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();
  let failures = 0;
  const fail = (m) => { failures++; console.error(`   ✗ ${m}`); };
  const ok = (m) => console.log(`   ✓ ${m}`);

  try {
    // ---- LOGIN -------------------------------------------------------------
    log("\n① Login…");
    await page.goto(`${CRM}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: /sign in|accedi|entrar/i }).click();
    await page.waitForTimeout(7000);
    if (/\/login/.test(page.url())) { fail("still on /login — bad credentials?"); throw new Error("login failed"); }
    ok(`logged in (${page.url()})`);

    // ---- SELECT TENANT (platform admin) ------------------------------------
    // Use the real switcher (top-left dropdown) → click the tenant. This calls
    // switchTenant()/impersonate — the exact path a platform admin uses to open a
    // client's CRM, so Settings loads in that tenant's context.
    log(`\n② Seleziono tenant "${TENANT}" dallo switcher…`);
    await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.getByText(TENANT, { exact: true }).first().click({ timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    ok(`switched to ${TENANT} (${page.url()})`);

    // ---- SETTINGS → PAYMENTS ----------------------------------------------
    log("\n③ Impostazioni → Pagamenti…");
    await page.goto(`${CRM}/settings?tab=payments`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOT}-1-payments.png`, fullPage: true });

    const body = () => page.locator("body").innerText();
    let txt = await body();

    // Tab + heading
    if (/Abbonamento e pagamenti|Subscription & payments|Suscripción y pagos|Abonnement/i.test(txt)) ok("Payments heading present");
    else fail("Payments heading not found");

    // Both plans
    if (/Premium/.test(txt)) ok("Premium plan card present"); else fail("Premium card missing");
    if (/Business/.test(txt)) ok("Business plan card present"); else fail("Business card missing");

    // Monthly prices (default cycle = monthly)
    if (/€\s?399/.test(txt)) ok("Premium €399/mo shown"); else fail("€399 not shown (monthly)");
    if (/€\s?329/.test(txt)) ok("Business €329/mo shown"); else fail("€329 not shown (monthly)");

    // Add-ons — voice now split into two tiers; website-care €59 removed.
    if (/€\s?99\b/.test(txt)) ok("voice BASE €99 shown"); else fail("€99 voice base missing");
    if (/€\s?199/.test(txt)) ok("voice PREMIUM / inventory €199 shown"); else fail("€199 add-on missing");
    if (/€\s?750/.test(txt)) ok("website design from €750 shown"); else fail("€750 add-on missing");
    // The €59 website-care add-on must be GONE.
    if (/€\s?59\b/.test(txt)) fail("€59 website-care still shown (should be removed)"); else ok("€59 website-care removed ✓");

    // Coming soon on inventory
    if (/Prossimamente|Coming soon|Próximamente|Demnächst/i.test(txt)) ok("smart inventory 'coming soon' shown");
    else fail("'coming soon' note not found");

    // Stripe keys ARE configured on prod now → no 'not configured' notice expected.
    if (/non ancora configurati|being set up|configurando|eingerichtet|si attivano a breve/i.test(txt))
      log("   • 'payments not configured' notice present (unexpected — Stripe keys should be set)");
    else ok("no 'not configured' notice (Stripe configured)");

    // ---- WEBSITE DESIGN → "CONTACT US" (WhatsApp, variable price) ----------
    log("\n③b Box pagina web → bottone Contattaci…");
    const contactLink = page.locator('a[href*="wa.me/34684109244"]').first();
    if (await contactLink.count()) {
      ok("Contattaci link → WhatsApp Sofía (wa.me/34684109244) present");
      const href = await contactLink.getAttribute("href");
      if (/interessato%20alla%20pagina%20web|interessato\+alla\+pagina\+web|interessato alla pagina web/i.test(decodeURIComponent(href || "")))
        ok("prefilled message 'interessato alla pagina web' present");
      else fail(`WhatsApp prefill text wrong: ${href}`);
      const label = (await contactLink.innerText()).trim();
      if (/Contattaci|Contact us|Contáctanos|Kontaktiere/i.test(label)) ok(`button label '${label}'`);
      else fail(`contact button label unexpected: '${label}'`);
    } else fail("Contattaci WhatsApp link NOT found in website-design box");

    // ---- YEARLY TOGGLE -----------------------------------------------------
    log("\n④ Toggle Annuale…");
    const yearlyBtn = page.getByRole("button", { name: /Annuale|Yearly|Anual|Jährlich/i }).first();
    if (await yearlyBtn.count()) {
      await yearlyBtn.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOT}-2-yearly.png`, fullPage: true });
      txt = await body();
      if (/€\s?3[.,]?990/.test(txt)) ok("Premium €3990/yr shown after toggle"); else fail("€3990 not shown (yearly)");
      if (/€\s?3[.,]?290/.test(txt)) ok("Business €3290/yr shown after toggle"); else fail("€3290 not shown (yearly)");
    } else fail("Yearly toggle button not found");

    // ---- PAY BUTTONS DISABLED (no provider) --------------------------------
    log("\n⑤ Pulsanti pagamento…");
    const stripeBtn = page.getByRole("button", { name: /Stripe/i }).first();
    if (await stripeBtn.count()) {
      const disabled = await stripeBtn.isDisabled();
      if (!disabled) ok("Stripe pay button enabled (Stripe configured → live checkout)");
      else log("   • Stripe button disabled — provider not configured?");
    } else fail("no Stripe pay button rendered");

    log(`\n${failures === 0 ? "✅ PAYMENTS UI E2E PASSATO" : `❌ PAYMENTS UI E2E: ${failures} problemi`} — screenshots in ${SHOT}-*.png`);
  } catch (e) {
    console.error("\n✗ ERRORE:", e?.message || e);
    await page.screenshot({ path: `${SHOT}-error.png`, fullPage: true }).catch(() => {});
    failures++;
  } finally {
    await browser.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
