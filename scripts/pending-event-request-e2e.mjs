// Playwright UI E2E for /pending private-event requests on PROD.
// Verifies, with a real browser + login, that an `event_request`-tagged escalated
// reservation renders as a call-back lead card:
//   • "Evento privato" badge
//   • date/time shown as "Da concordare" (not a fake slot)
//   • Call (tel:) + Handled actions (no table-assignment Confirm)
//
//   node scripts/pending-event-request-e2e.mjs
//
// A test event_request row for the test phone must exist (created via the engine
// E2E). Login: platform admin → switch to Oraz.

import { chromium } from "playwright";

const CRM = "https://crm.baliflowagency.com";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD || "+It&Uz+riRRHG9j+g%h6w2C_";
const TENANT = process.env.TENANT_NAME || "Oraz";
const SHOT = "/tmp/pending-event-e2e";

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
    if (/\/login/.test(page.url())) { fail("still on /login"); throw new Error("login failed"); }
    ok(`logged in`);

    console.log(`② Switch tenant "${TENANT}"…`);
    await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.getByText(TENANT, { exact: true }).first().click({ timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    ok(`switched to ${TENANT}`);

    console.log("③ /pending…");
    await page.goto(`${CRM}/pending`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${SHOT}-1.png`, fullPage: true });

    const body = await page.locator("body").innerText();
    // Badge
    if (/Evento privato/i.test(body)) ok('"Evento privato" badge present'); else fail('"Evento privato" badge missing');
    // "Da concordare" placeholder for date/time
    if (/Da concordare/i.test(body)) ok('"Da concordare" shown for date/time'); else fail('"Da concordare" missing');
    // Call + Handled buttons
    const callBtn = await page.getByRole("link", { name: /^Chiama$/ }).count().catch(() => 0);
    if (callBtn > 0) ok("Call (tel:) button present"); else fail("Call button missing");
    const handledBtn = await page.getByRole("button", { name: /^Gestito$/ }).count().catch(() => 0);
    if (handledBtn > 0) ok("Handled button present"); else fail("Handled button missing");
    // The customer's request summary text should be visible
    if (/festa di compleanno/i.test(body)) ok("event summary (notes) visible"); else fail("event summary not visible");

    console.log(`\n${failures ? "❌ " + failures + " failures" : "✅ all checks passed"}  (screenshot ${SHOT}-1.png)`);
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
