// Playwright UI E2E: assign tables to a private-event request on PROD.
// Flow: login → Oraz → /pending → locate the event_request card → set agreed
// date/time/party → "Assegna tavoli" → pick a table in the picker → confirm →
// assert the card leaves /pending (became a confirmed reservation).
//
//   TEST_PHONE_TAIL=333111 node scripts/pending-event-assign-e2e.mjs
//
// Needs a fresh event_request lead for the test phone (create via engine E2E).

import { chromium } from "playwright";

const CRM = "https://crm.baliflowagency.com";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD || "+It&Uz+riRRHG9j+g%h6w2C_";
const TENANT = process.env.TENANT_NAME || "Oraz";
const PHONE_TAIL = process.env.TEST_PHONE_TAIL || "333111";
const SHOT = "/tmp/pending-event-assign";

// agreed values to set on the event
const AGREED_DATE = process.env.AGREED_DATE || "2026-06-27";
const AGREED_TIME = process.env.AGREED_TIME || "20:00";
const AGREED_PARTY = process.env.AGREED_PARTY || "40";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();
  let failures = 0;
  const fail = (m) => { failures++; console.error(`   ✗ ${m}`); };
  const ok = (m) => console.log(`   ✓ ${m}`);

  try {
    console.log("① Login…");
    await page.goto(`${CRM}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: /sign in|accedi|entrar/i }).click();
    await page.waitForTimeout(7000);
    if (/\/login/.test(page.url())) { fail("login failed"); throw new Error("login"); }
    ok("logged in");

    console.log(`② Switch tenant "${TENANT}"…`);
    await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.getByText(TENANT, { exact: true }).first().click({ timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    ok(`switched`);

    console.log("③ /pending → locate event card…");
    await page.goto(`${CRM}/pending`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);

    // The outer card: the bordered container that holds the event badge. Use the
    // top-level row wrapper (rounded-xl border-2) that contains our phone tail.
    const card = page.locator('div.border-2.rounded-xl', { hasText: new RegExp(PHONE_TAIL) }).filter({ hasText: /Evento privato/i }).first();
    if (await card.count() === 0) { fail(`no event card with phone tail ${PHONE_TAIL}`); await page.screenshot({ path: `${SHOT}-nocard.png`, fullPage: true }); throw new Error("no card"); }
    ok("event card found");
    await page.screenshot({ path: `${SHOT}-1-before.png`, fullPage: true });

    console.log("④ Set agreed date/time/party…");
    await card.locator('input[type="date"]').first().fill(AGREED_DATE);
    await card.locator('input[type="time"]').first().fill(AGREED_TIME);
    await card.locator('input[type="number"]').first().fill(AGREED_PARTY);
    ok(`set ${AGREED_DATE} ${AGREED_TIME} ${AGREED_PARTY}p`);

    console.log("⑤ Assegna tavoli…");
    const assignBtn = card.getByRole("button", { name: /Assegna tavoli|Assign tables|Asignar mesas|Tische zuweisen/i }).first();
    await assignBtn.scrollIntoViewIfNeeded();
    await assignBtn.click({ timeout: 8000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOT}-2-picker.png`, fullPage: true });

    // The table picker should now be open within this card. Pick the first available table.
    const tableBtn = card.locator('button').filter({ hasText: /^\s*(Mesa|Tavolo|Table|Tisch|T\d|\d+)\b/i });
    // Fallback: any clickable table tile in the green picker panel.
    let picked = false;
    const candidates = await card.locator('button').all();
    for (const b of candidates) {
      const txt = (await b.innerText().catch(() => "")).trim();
      // table tiles show a name + seats; skip the action buttons
      if (/posti|seats|plazas|Plätze|pax/i.test(txt) || /^[A-Za-z]?\d+/.test(txt)) {
        await b.click().catch(() => {});
        picked = true;
        break;
      }
    }
    if (!picked) { fail("no table tile to pick"); await page.screenshot({ path: `${SHOT}-notile.png`, fullPage: true }); }
    else ok("table picked");
    await page.waitForTimeout(1000);

    console.log("⑥ Confirm…");
    const confirmBtn = card.getByRole("button", { name: /Conferma con|Confirm with|Confirmar con|Bestätigen mit|Conferma|Confirm/i }).last();
    await confirmBtn.click();
    await page.waitForTimeout(4000);
    // dismiss a possible seat-mismatch warning by proceeding anyway
    const warnConfirm = page.getByRole("button", { name: /Sì, procedi|Sí, proceder|Yes, proceed|Ja, fortfahren|procedi|proceed/i });
    if (await warnConfirm.count() > 0) { await warnConfirm.first().click().catch(() => {}); await page.waitForTimeout(4000); }
    await page.screenshot({ path: `${SHOT}-3-after.png`, fullPage: true });

    console.log("⑦ Verify card left /pending…");
    await page.waitForTimeout(2500);
    const stillThere = await page.locator("div", { hasText: new RegExp(PHONE_TAIL) }).filter({ hasText: /Evento privato/i }).count();
    if (stillThere === 0) ok("event card gone from /pending (confirmed)");
    else fail("event card still on /pending");

    console.log(`\n${failures ? "❌ " + failures + " failures" : "✅ all checks passed"}`);
  } catch (e) {
    console.error("ERROR:", e.message);
    failures++;
    await page.screenshot({ path: `${SHOT}-error.png`, fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
  process.exit(failures ? 1 : 0);
}
main();
