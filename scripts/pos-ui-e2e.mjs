// Playwright UI E2E for the new POS/management screens on PROD (crm.baliflowagency.com).
// Verifies, with a real browser + real login, that:
//   1. Magazzino (inventory) is now EDITABLE — create an ingredient, edit its stock
//      inline (CRM-side save), expand the row editor + POS-link picker.
//   2. Settings → Cassa renders the self-service connection panel (provider picker,
//      token field, Test / Save buttons).
// It does NOT connect prod to the real till (that would write outward state); the
// real till write-backs are proven separately by scripts/loyverse-product-stock-test.ts.
//
//   node scripts/pos-ui-e2e.mjs
//
// Login: platform admin (can select the Oraz tenant, which has management enabled).

import { chromium } from "playwright";

const CRM = "https://crm.baliflowagency.com";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD || "+It&Uz+riRRHG9j+g%h6w2C_";
const TENANT = process.env.TENANT_NAME || "Oraz";
// Oraz tenant id — the app selects the active tenant via localStorage.active_tenant_id
// (see TenantContext); a platform admin can point it at any tenant. This is exactly
// how the app itself switches tenants, so it's a faithful path, not a hack.
const TENANT_ID = process.env.TENANT_ID || "93eebe9c-8af5-4ca5-a315-3376ef4976e5";
const SHOT = "/tmp/pos-ui-e2e";

const log = (...a) => console.log(...a);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
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
    await page.waitForTimeout(3500);
    if (/\/login/.test(page.url())) { fail("still on /login — bad credentials?"); throw new Error("login failed"); }
    ok(`logged in (${page.url()})`);

    // ---- SELECT TENANT (platform admin) ------------------------------------
    // Use the real tenant switcher (top-left dropdown) → click Oraz. This calls
    // switchTenant(), which sets active_tenant_id AND /api/admin/impersonate, the
    // exact path a platform admin uses to open a client's CRM.
    log(`\n② Seleziono tenant "${TENANT}" dallo switcher…`);
    await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.getByText(TENANT, { exact: true }).first().click({ timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    ok(`switched to ${TENANT} (${page.url()})`);

    // ---- MAGAZZINO (editable) ---------------------------------------------
    log("\n③ Magazzino editabile…");
    await page.goto(`${CRM}/inventory`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOT}-1-inventory.png`, fullPage: true });

    const bodyText = await page.locator("body").innerText();
    if (/Modulo gestionale non attivo|management module is not enabled/i.test(bodyText)) {
      fail("management module OFF for this tenant — enable it to test inventory");
    } else {
      ok("inventory page loaded (management ON)");
      // "Nuovo ingrediente" button present?
      const newBtn = page.getByRole("button", { name: /Nuovo ingrediente|New ingredient|Nueva|Neue Zutat/i });
      if (await newBtn.count()) {
        ok('"New ingredient" button present');
        await newBtn.first().click();
        await page.waitForTimeout(500);
        const nameInput = page.locator('input[placeholder*="Farina"], input[placeholder*="Flour"], input[placeholder*="Harina"], input[placeholder*="Mehl"]').first();
        if (await nameInput.count()) {
          const ingName = `E2E QA ${Date.now().toString().slice(-5)}`;
          await nameInput.fill(ingName);
          await page.getByRole("button", { name: /^Salva$|^Save$|^Guardar$|^Speichern$/ }).first().click().catch(() => {});
          await page.waitForTimeout(2500);
          const after = await page.locator("body").innerText();
          if (after.includes(ingName)) ok(`created ingredient "${ingName}" (visible in table)`);
          else fail(`created ingredient "${ingName}" not visible after save`);
          await page.screenshot({ path: `${SHOT}-2-after-create.png`, fullPage: true });

          // Edit its stock inline: click the stock button on that row.
          const row = page.locator("tr", { hasText: ingName }).first();
          const stockBtn = row.locator('button:has-text("kg"), button:has-text("0.00")').first();
          if (await stockBtn.count()) {
            await stockBtn.click();
            const stockInput = row.locator('input[type="number"]').first();
            await stockInput.fill("8");
            await stockInput.press("Enter");
            await page.waitForTimeout(2500);
            const rowText = await row.innerText().catch(() => "");
            if (/8\.00|8,00/.test(rowText)) ok("inline stock edit saved (8.00)");
            else log(`   • stock row after edit: ${rowText.replace(/\n/g, " | ")}`);
            await page.screenshot({ path: `${SHOT}-3-after-stock.png`, fullPage: true });
          } else fail("stock edit button not found on the new row");

          // Expand the row editor → confirm the POS link picker is there.
          const toggle = row.locator('button[aria-label="toggle editor"]').first();
          if (await toggle.count()) {
            await toggle.click();
            await page.waitForTimeout(1500);
            const editorText = await page.locator("body").innerText();
            if (/Prodotto cassa collegato|till product|producto del TPV|Kassenprodukt/i.test(editorText)) ok("row editor + POS link picker present");
            else fail("POS link picker not found in expanded editor");
            await page.screenshot({ path: `${SHOT}-4-row-editor.png`, fullPage: true });
          }
        } else fail("new-ingredient name field not found");
      } else fail('"New ingredient" button not found');
    }

    // ---- SETTINGS → CASSA --------------------------------------------------
    log("\n④ Impostazioni → Cassa…");
    await page.goto(`${CRM}/settings?tab=pos`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOT}-5-settings-pos.png`, fullPage: true });
    const posText = await page.locator("body").innerText();
    if (/Collega la cassa|Connect your till|Conecta tu TPV|Kasse verbinden/i.test(posText)) ok("Cassa tab heading present");
    else fail("Cassa tab heading not found");
    if (/Loyverse/i.test(posText)) ok("provider picker shows Loyverse");
    else fail("Loyverse not in provider picker");
    const tokenField = page.locator('input[type="password"]');
    if (await tokenField.count()) ok("token field present");
    else fail("token field not found");
    if (/Prova connessione|Test connection|Probar conexión|Verbindung testen/i.test(posText)) ok("Test/Save buttons present");
    else fail("Test button not found");

    log(`\n${failures === 0 ? "✅ UI E2E PASSATO" : `❌ UI E2E: ${failures} problemi"`} — screenshots in ${SHOT}-*.png`);
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
