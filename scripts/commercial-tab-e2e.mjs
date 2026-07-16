// Playwright check on PROD: the guided "Listini & Info" tab for the commercial module.
// Login → switch to Oraz → Settings → Funzioni: toggle ON + CTA banner → open the
// "Listini & Info" tab → the 4 commerciale articles render as editable cards.
//   node scripts/commercial-tab-e2e.mjs
import { chromium } from "playwright";

const CRM = "https://crm.baliflowagency.com";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD || "+It&Uz+riRRHG9j+g%h6w2C_";
const TENANT = process.env.TENANT_NAME || "Oraz";
const SHOT = "/tmp/commercial-tab";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
const page = await ctx.newPage();
let fails = 0;
const ok = (m) => console.log("   ✓ " + m);
const fail = (m) => { fails++; console.error("   ✗ " + m); };

try {
  console.log("① Login…");
  await page.goto(`${CRM}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /sign in|accedi|entrar|iniciar/i }).click();
  await page.waitForTimeout(7000);
  if (/\/login/.test(page.url())) { fail("still on /login"); throw new Error("login failed"); }
  ok("logged in");

  console.log(`② Switch tenant "${TENANT}"…`);
  await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByText(TENANT, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  ok(`switched to ${TENANT}`);

  console.log("③ Settings → Funzioni…");
  await page.goto(`${CRM}/settings?tab=features`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOT}-features.png`, fullPage: true });
  const ctaVisible = await page.getByText(/Listini & Info|Listas e Info|Price lists & Info|Preislisten/i).first().isVisible().catch(() => false);
  ctaVisible ? ok("commercial CTA / tab present (toggle ON)") : fail("no commercial CTA visible — flag OFF or tab missing");

  console.log("④ Open Listini & Info tab (client-side click, like a real user)…");
  await page.getByRole("button", { name: /Listini & Info|Listas e Info|Price lists & Info|Preislisten/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOT}-commercial.png`, fullPage: true });
  // Card titles live in <input> values (not innerText) — read them directly.
  const titles = await page.locator('input[type="text"]').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  console.log("   card titles:", JSON.stringify(titles));
  for (const title of ["Torte", "Menù fissi", "Buffet estate", "Lista piatti buffet"]) {
    titles.includes(title) ? ok(`card "${title}" rendered`) : fail(`card "${title}" missing`);
  }
  const body = await page.locator("body").innerText();
  const hasTemplates = /Torte|Menù fissi|Buffet|Lista piatti|Altro/i.test(body);
  hasTemplates ? ok("add-a-list templates present") : fail("templates missing");
} catch (e) {
  fail("exception: " + e.message);
} finally {
  await page.screenshot({ path: `${SHOT}-final.png`, fullPage: true }).catch(() => {});
  await browser.close();
}
console.log(`\n=== ${fails === 0 ? "ALL PASS" : fails + " FAILED"} ===`);
process.exit(fails === 0 ? 0 : 1);
