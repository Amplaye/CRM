// Playwright UI E2E for the NATIVE cassa (/cassa) on PROD (crm.baliflowagency.com).
// Full money loop with a real browser + real login on the Oraz tenant
// (management enabled): counter sale → open item €1 → charge cash → receipt
// appears in the day journal → void it (keeps the numbered record) → close-of-day
// panel renders. The €1 receipt ends VOIDED, so the run leaves no revenue behind.
//
// Prerequisite: scripts/migrations/2026-07-04-cassa.sql applied to the DB
// (the script detects the missing migration and says so).
//
//   node scripts/cassa-e2e.mjs
//
// Login: platform admin (selects the tenant via the real switcher, same as
// scripts/pos-ui-e2e.mjs).

import { chromium } from "playwright";

const CRM = "https://crm.baliflowagency.com";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD || "+It&Uz+riRRHG9j+g%h6w2C_";
const TENANT = process.env.TENANT_NAME || "Oraz";
const SHOT = "/tmp/cassa-e2e";

const log = (...a) => console.log(...a);

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  let failures = 0;
  const fail = (m) => { failures++; console.error(`   ✗ ${m}`); };
  const ok = (m) => console.log(`   ✓ ${m}`);

  // The cassa uses confirm() for storni and prompt() for the void reason.
  page.on("dialog", (d) => d.accept("E2E annullo di prova"));

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

    // ---- SELECT TENANT -------------------------------------------------------
    log(`\n② Seleziono tenant "${TENANT}"…`);
    await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.getByText(TENANT, { exact: true }).first().click({ timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    ok(`switched to ${TENANT}`);

    // ---- CASSA HOME ----------------------------------------------------------
    log("\n③ /cassa…");
    await page.goto(`${CRM}/cassa`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOT}-1-sala.png`, fullPage: true });
    const home = await page.locator("body").innerText();
    if (/Manca la migrazione|migration missing|Falta la migración|Migration fehlt/i.test(home)) {
      fail("MIGRAZIONE MANCANTE: esegui scripts/migrations/2026-07-04-cassa.sql nel SQL editor di Supabase, poi rilancia.");
      throw new Error("migration missing");
    }
    if (/Questa sezione sarà presto disponibile|coming soon/i.test(home)) {
      fail("management add-on OFF per questo tenant");
      throw new Error("management off");
    }
    ok("cassa page loaded");

    // ---- COUNTER SALE → OPEN ITEM €1 ----------------------------------------
    log("\n④ Vendita al banco con voce libera €1…");
    await page.getByRole("button", { name: /^(Banco|Counter|Barra|Theke)$/i }).first().click();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /Voce libera|Open item|Línea libre|Freie Position/i }).first().click();
    await page.waitForTimeout(500);
    const desc = `E2E Cassa ${Date.now().toString().slice(-5)}`;
    await page.locator('input[placeholder*="Varie"], input[placeholder*="misc"], input[placeholder*="Varios"], input[placeholder*="Diverses"]').first().fill(desc);
    await page.locator('input[placeholder="0.00"]').first().fill("1.00");
    await page.getByRole("button", { name: /^(Aggiungi|Add|Añadir|Hinzufügen)$/i }).first().click();
    await page.waitForTimeout(500);
    const ticket = await page.locator("body").innerText();
    if (ticket.includes(desc)) ok(`riga "${desc}" nel conto`);
    else fail("riga libera non comparsa nel conto");
    await page.screenshot({ path: `${SHOT}-2-order.png`, fullPage: true });

    // ---- CHARGE CASH ----------------------------------------------------------
    log("\n⑤ Incasso in contanti…");
    const chargeRe = /(Incassa|Charge|Cobrar|Kassieren) · /i;
    // The ticket "Incassa" and the pay-sheet confirm share the same label, so
    // scope the first click to the ticket column — otherwise Playwright's retry
    // (the button is briefly disabled while the comanda fires) can land on the
    // pay-sheet overlay that has meanwhile opened.
    const ticketPanel = page.locator(".lg\\:w-\\[380px\\]");
    await ticketPanel.getByRole("button", { name: chargeRe }).click();
    // Wait for the pay sheet (fixed inset-0 z-50 overlay) to actually be up.
    const paySheet = page.locator("div.fixed.inset-0.z-50").last();
    await paySheet.waitFor({ state: "visible", timeout: 15000 });
    // "Esatto" pre-fills Ricevuto = importo so the cash path is unambiguous.
    await paySheet.getByRole("button", { name: /^(Esatto|Exact|Exacto|Genau)$/i }).click().catch(() => {});
    await page.screenshot({ path: `${SHOT}-3-paymodal.png`, fullPage: true });
    // The confirm button is briefly disabled while the comanda finishes firing
    // (page-level busy). Wait for it to become enabled, then click.
    const confirmBtn = paySheet.getByRole("button", { name: chargeRe });
    await confirmBtn.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction(
      (el) => el && !el.disabled,
      await confirmBtn.elementHandle(),
      { timeout: 15000 },
    ).catch(() => {});
    await confirmBtn.click();
    // The pay POST (claim → receipt no. → payments → pos_sales mirror → stock)
    // can take a few seconds on prod — wait for the success screen, not a
    // fixed 3s (which raced it and then the still-open sheet blocked step ⑥).
    const successMsg = page.getByText(/\b(Incassato|Paid|Cobrado|Kassiert)\b/);
    try {
      await successMsg.first().waitFor({ state: "visible", timeout: 25000 });
      const paid = await page.locator("body").innerText();
      const rcpt = paid.match(/N\.\s*(\d+)\/(\d{4})/);
      ok(`incassato${rcpt ? ` — scontrino N. ${rcpt[1]}/${rcpt[2]}` : ""}`);
    } catch {
      fail("conferma di incasso non visibile");
    }
    await page.screenshot({ path: `${SHOT}-4-paid.png`, fullPage: true });
    await page.getByRole("button", { name: /^(Fatto|Done|Listo|Fertig)$/i }).first().click().catch(() => {});
    // The sheet must be fully gone or its overlay swallows the tab clicks below.
    await paySheet.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);

    // ---- DAY JOURNAL → VOID ----------------------------------------------------
    log("\n⑥ Scontrini del giorno + annullo…");
    await page.getByRole("button", { name: /Scontrini|Receipts|Tickets|Bons/i }).first().click();
    await page.waitForTimeout(2500);
    const journal = await page.locator("body").innerText();
    if (/1[.,]00/.test(journal)) ok("scontrino €1.00 nel giornale");
    else fail("scontrino non trovato nel giornale");
    await page.screenshot({ path: `${SHOT}-5-journal.png`, fullPage: true });
    // Expand the newest receipt (first row) and void it.
    await page.locator("button", { hasText: /^#/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    const voidBtn = page.getByRole("button", { name: /Annulla scontrino|Void receipt|Anular ticket|Bon stornieren/i }).first();
    if (await voidBtn.count()) {
      await voidBtn.click(); // prompt auto-accepted by the dialog handler
      await page.waitForTimeout(3000);
      const after = await page.locator("body").innerText();
      if (/ANNULLATO|VOIDED|ANULADO|STORNIERT/.test(after)) ok("annullo registrato (badge visibile)");
      else fail("badge di annullo non visibile");
      await page.screenshot({ path: `${SHOT}-6-voided.png`, fullPage: true });
    } else fail("bottone annullo non trovato (serve owner/manager)");

    // ---- CLOSE-OF-DAY PANEL -----------------------------------------------------
    log("\n⑦ Pannello chiusura…");
    await page.getByRole("button", { name: /Chiusura|Close of day|Cierre|Tagesabschluss/i }).first().click();
    await page.waitForTimeout(2000);
    const closing = await page.locator("body").innerText();
    if (/Riepilogo|summary|Resumen|Tagesübersicht/i.test(closing)) ok("riepilogo giornata visibile");
    else fail("riepilogo giornata non visibile");
    await page.screenshot({ path: `${SHOT}-7-close.png`, fullPage: true });
    // NON chiudiamo la sessione: è la cassa reale del tenant.

  } catch (err) {
    console.error("\nE2E error:", err.message);
    failures++;
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? "\n✅ CASSA E2E: tutto ok" : `\n❌ CASSA E2E: ${failures} problemi (screenshot in ${SHOT}-*.png)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
