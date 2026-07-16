// E2E: Settings → Email must speak the tenant's CRM language, not Italian.
//
// The whole point of the fix: this panel decides whether a venue can send email
// at all, and it used to be hardcoded Italian — an owner in Berlin or Madrid hit
// a wall of a language they don't read. One real tenant already exists per
// locale, so this test mutates nothing:
//   WoodWay=en · Lugares Mágicos=es · Oraz=it · Gabelstapler=de
//
// A platform admin can impersonate any tenant by pinning active_tenant_id, and
// the language bridge then forces that tenant's crm_locale. Each tenant gets a
// FRESH browser context: TenantContext caches its snapshot in sessionStorage, so
// reusing one context would carry the previous tenant's language over.
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

// Sentinels: phrases that exist in exactly one language's dictionary.
const CASES = [
  {
    slug: "woodway-416hls", lang: "en",
    expect: ["Connect your key here", "Sender address", "Test connection", "How to connect your account"],
    forbid: ["Collega la tua chiave", "Indirizzo mittente", "Prova connessione"],
  },
  {
    slug: "lugares-magicos-ks1vup", lang: "es",
    expect: ["Conecta aquí tu clave", "Dirección del remitente", "Probar conexión", "Cómo conectar tu cuenta"],
    forbid: ["Collega la tua chiave", "Indirizzo mittente", "Prova connessione"],
  },
  {
    slug: "oraz-t0221f", lang: "it",
    expect: ["Collega la tua chiave", "Indirizzo mittente", "Prova connessione", "Come collegare il tuo account"],
    forbid: ["Sender address", "Dirección del remitente", "Absenderadresse"],
  },
  {
    slug: "gabelstapler-xq1fpc", lang: "de",
    expect: ["Verbinden Sie hier Ihren Schlüssel", "Absenderadresse", "Verbindung testen", "So verbinden Sie Ihr Konto"],
    forbid: ["Collega la tua chiave", "Indirizzo mittente", "Prova connessione"],
  },
];

const browser = await chromium.launch();
let pass = 0, fail = 0;

for (const c of CASES) {
  const t = bySlug[c.slug];
  if (!t) { console.log(`✗ [${c.lang}] tenant ${c.slug} not found`); fail++; continue; }

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Hydration must finish before typing, or React's state stays empty and the
  // submit silently does nothing.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@baliflow.com");
  await page.fill('input[type="password"]', "+It&Uz+riRRHG9j+g%h6w2C_");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.includes("/login"), null, { timeout: 30000 });

  await page.evaluate((id) => localStorage.setItem("active_tenant_id", id), t.id);
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });

  // The bridge applies crm_locale after the first paint, so reading the DOM at
  // networkidle would catch the default English on every tenant.
  await page.waitForFunction((lang) => localStorage.getItem("app_lang_v2") === lang, c.lang, { timeout: 25000 });
  await page.waitForTimeout(600);

  const tab = page.locator('button:has-text("Email")').first();
  await tab.waitFor({ timeout: 20000 });
  await tab.click();
  await page.waitForTimeout(1200);

  const body = await page.locator("main").innerText();
  const missing = c.expect.filter((s) => !body.includes(s));
  const leaked = c.forbid.filter((s) => body.includes(s));

  if (missing.length || leaked.length) {
    console.log(`✗ [${c.lang}] ${t.name}`);
    if (missing.length) console.log(`    missing: ${missing.map((s) => JSON.stringify(s)).join(", ")}`);
    if (leaked.length) console.log(`    other language leaked in: ${leaked.map((s) => JSON.stringify(s)).join(", ")}`);
    console.log(body.split("\n").filter((l) => l.trim()).slice(0, 12).map((l) => "    | " + l).join("\n"));
    fail++;
  } else {
    console.log(`✓ [${c.lang}] ${t.name} — Email panel fully in ${c.lang}`);
    const line = body.split("\n").find((l) => l.includes("Resend"))?.trim() || "";
    console.log(`    "${line.slice(0, 96)}…"`);
    pass++;
  }

  await page.screenshot({
    path: `/private/tmp/claude-501/-Users-amplaye/5dc486e3-abe6-4c4d-bd5f-c069a090099a/scratchpad/email-${c.lang}.png`,
    fullPage: true,
  });
  await ctx.close();
}

await browser.close();
console.log(`\n${fail === 0 ? "✅" : "❌"} Email i18n: ${pass}/${CASES.length} locales correct`);
process.exit(fail ? 1 : 0);
