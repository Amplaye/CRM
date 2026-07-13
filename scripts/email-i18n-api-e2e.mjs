// E2E: the messages the Email panel gets back from /api/marketing/email-provider
// must also land in the tenant's language. They used to be Italian sentences
// built server-side; now the API answers with a dictionary key (`code`) + vars
// and the browser renders it through t().
//
// This drives the real failure path an owner hits first: pasting a key Resend
// rejects. Nothing is stored (a rejected key is never saved), so no tenant is
// mutated.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3210";
const env = Object.fromEntries(
  readFileSync("/Users/amplaye/CRM/.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tenants?select=id,name,slug,settings`, {
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
});
const bySlug = Object.fromEntries((await res.json()).map((t) => [t.slug, t]));

// The rejected-key message (email_msg_key_rejected), one sentinel per language.
const CASES = [
  { slug: "woodway-416hls", lang: "en", expect: "Key rejected by Resend" },
  { slug: "lugares-magicos-ks1vup", lang: "es", expect: "Clave rechazada por Resend" },
  { slug: "oraz-t0221f", lang: "it", expect: "Chiave rifiutata da Resend" },
  { slug: "gabelstapler-xq1fpc", lang: "de", expect: "Schlüssel von Resend abgelehnt" },
];

const browser = await chromium.launch();
let pass = 0, fail = 0;

for (const c of CASES) {
  const t = bySlug[c.slug];
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@baliflow.com");
  await page.fill('input[type="password"]', "+It&Uz+riRRHG9j+g%h6w2C_");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.includes("/login"), null, { timeout: 30000 });

  await page.evaluate((id) => localStorage.setItem("active_tenant_id", id), t.id);
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.waitForFunction((l) => localStorage.getItem("app_lang_v2") === l, c.lang, { timeout: 25000 });
  await page.waitForTimeout(500);

  await page.locator('button:has-text("Email")').first().click();
  await page.waitForTimeout(1000);

  // Paste a key Resend will reject, then hit the test button.
  await page.locator('input[type="password"]').first().fill("re_this_key_does_not_exist_000000");
  const testBtn = page.locator("button").filter({ hasText: /Test connection|Probar conexión|Prova connessione|Verbindung testen/ }).first();
  await testBtn.click();

  // Wait for the API's verdict to render.
  await page.waitForFunction(
    (s) => document.querySelector("main")?.innerText.includes(s),
    c.expect,
    { timeout: 30000 },
  ).then(() => {
    console.log(`✓ [${c.lang}] ${t.name} — API error message in ${c.lang}: "${c.expect}…"`);
    pass++;
  }).catch(async () => {
    const body = await page.locator("main").innerText();
    const shown = body.split("\n").find((l) => /Resend/i.test(l) && l.length < 160) || "(no message found)";
    console.log(`✗ [${c.lang}] ${t.name} — expected "${c.expect}", got: "${shown.trim()}"`);
    fail++;
  });

  await page.screenshot({
    path: `/private/tmp/claude-501/-Users-amplaye/5dc486e3-abe6-4c4d-bd5f-c069a090099a/scratchpad/email-api-${c.lang}.png`,
    fullPage: true,
  });
  await ctx.close();
}

await browser.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} Email API messages i18n: ${pass}/${CASES.length} locales correct`);
process.exit(fail ? 1 : 0);
