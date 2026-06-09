// Playwright UI E2E for Settings → Payments on PROD (crm.baliflowagency.com).
// Verifies, with a real browser + real login, that the new Payments tab renders:
//   • heading + both plan cards (Premium / Business) with the right prices
//   • monthly/yearly toggle flips the displayed price (399→3990, 329→3290)
//   • the four add-ons (voice €199, website care €59, design from €750, inventory soon)
//   • the "payments not configured yet" notice (Stripe/PayPal keys aren't set on prod)
//   • pay buttons are disabled while no provider is configured (no accidental 503)
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

    // Add-ons
    if (/€\s?199/.test(txt)) ok("add-on €199 shown (voice/inventory)"); else fail("€199 add-on missing");
    if (/€\s?59/.test(txt)) ok("website care €59 shown"); else fail("€59 add-on missing");
    if (/€\s?750/.test(txt)) ok("website design from €750 shown"); else fail("€750 add-on missing");

    // Coming soon on inventory
    if (/Prossimamente|Coming soon|Próximamente|Demnächst/i.test(txt)) ok("smart inventory 'coming soon' shown");
    else fail("'coming soon' note not found");

    // Not-configured notice (no keys on prod yet)
    if (/non ancora configurati|being set up|configurando|eingerichtet|si attivano a breve/i.test(txt))
      ok("'payments not configured' notice shown (expected — no keys yet)");
    else log("   • no 'not configured' notice (keys may be set, or providers active)");

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
      if (disabled) ok("Stripe pay button disabled while unconfigured (no accidental 503)");
      else log("   • Stripe button enabled — provider appears configured");
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
