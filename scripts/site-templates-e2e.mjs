// Playwright E2E for the website templates (Fase 4bis — template multipli +
// editor visuale). Runs against a LOCAL production build (next start):
//
//   npm run build && npx next start -p 3010 &
//   node scripts/site-templates-e2e.mjs
//
// For each template it flips settings.site_branding.template on the QA tenant
// (service role), renders /s/<slug>, screenshots it and checks the booking
// widget is wired. Then it exercises the widget (availability call) and the
// visual editor end-to-end (login → /website/editor → edit a text block →
// save → the override lands in settings.site_content and shows on /s).
// The tenant's original site_branding/site_content are restored at the end.

import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE || "http://localhost:3010";
const SLUG = process.env.TENANT_SLUG || "bali-rest-ghl8po";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/site-templates-e2e";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD;
const TENANT_NAME = process.env.TENANT_NAME || "BALI Rest";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    // Vercel CLI writes values quoted — strip the quotes.
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const TEMPLATES = ["classic", "suerte", "dolcevita", "champinoneria", "picnic", "perezbeers", "vasco", "montesdeoca"];

let failures = 0;
const ok = (m) => console.log(`   ✓ ${m}`);
const fail = (m) => { failures++; console.error(`   ✗ ${m}`); };

async function getTenant() {
  const { data, error } = await sb.from("tenants").select("id,name,slug,settings").eq("slug", SLUG).single();
  if (error) throw error;
  return data;
}

async function setTemplate(tenant, key) {
  const settings = tenant.settings || {};
  const site = { ...(settings.site_branding || {}), template: key };
  const { error } = await sb.from("tenants").update({ settings: { ...settings, site_branding: site } }).eq("id", tenant.id);
  if (error) throw error;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const tenant = await getTenant();
  const originalSettings = JSON.parse(JSON.stringify(tenant.settings || {}));
  console.log(`Tenant: ${tenant.name} (${tenant.slug})`);

  const browser = await chromium.launch();
  const page = await browser.newContext({ viewport: { width: 1400, height: 1000 } }).then((c) => c.newPage());

  try {
    // ── 1. Render + screenshot every template ─────────────────────────────
    for (const key of TEMPLATES) {
      console.log(`\n① /s con template "${key}"…`);
      await setTemplate({ ...tenant, settings: originalSettings }, key);
      const res = await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: "networkidle", timeout: 45000 });
      if (!res || res.status() !== 200) { fail(`${key}: HTTP ${res?.status()}`); continue; }
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOT_DIR}/${key}.png`, fullPage: true });
      if (key === "classic") {
        const hasBookLink = await page.locator(`a[href="/b/${SLUG}"]`).count();
        hasBookLink ? ok("classic renders + link /b presente") : fail("classic: manca il link /b");
      } else {
        const dateInputs = await page.locator('input[type="date"]').count();
        dateInputs > 0 ? ok(`${key}: widget prenotazione presente`) : fail(`${key}: widget prenotazione MANCANTE`);
      }
    }

    // ── 2. Widget live: availability call from inside a template ──────────
    console.log('\n② Widget: "vedi disponibilità" dal template suerte…');
    await setTemplate({ ...tenant, settings: originalSettings }, "suerte");
    await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: "networkidle" });
    const in3days = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    await page.locator('input[type="date"]').first().fill(in3days);
    const [availRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/public/availability"), { timeout: 20000 }),
      page.locator("#reserva button").first().click(),
    ]);
    availRes.ok() ? ok(`availability HTTP ${availRes.status()}`) : fail(`availability HTTP ${availRes.status()}`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOT_DIR}/suerte-widget.png`, fullPage: false });

    // ── 3. Visual editor: edit hero title in place → save → live on /s ────
    if (!PASSWORD) {
      console.log("\n③ Editor: SKIP (nessuna CRM_PASSWORD in env)");
    } else {
      console.log("\n③ Editor visuale: login → modifica → salva…");
      await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
      await page.fill("#email", EMAIL);
      await page.fill("#password", PASSWORD);
      await page.getByRole("button", { name: /sign in|accedi|entrar/i }).click();
      await page.waitForTimeout(3500);
      if (/\/login/.test(page.url())) { fail("login fallito"); throw new Error("login"); }
      ok("login");
      await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
      await page.waitForTimeout(800);
      await page.getByText(TENANT_NAME, { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);

      await page.goto(`${BASE}/website/editor`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      const marker = `E2E ${Date.now()}`;
      const block = page.locator('[data-block-id="hero.title"]').first();
      if ((await block.count()) === 0) {
        fail("editor: blocco hero.title non trovato");
      } else {
        await block.click();
        await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
        await page.keyboard.type(marker);
        await page.locator("header, body").first().click({ position: { x: 5, y: 5 } }); // blur → commit
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOT_DIR}/editor.png`, fullPage: false });
        await page.getByRole("button", { name: /salva|guardar|save|speichern/i }).click();
        await page.waitForTimeout(2500);
        const after = await getTenant();
        const saved = after.settings?.site_content?.suerte?.["hero.title"];
        saved === marker ? ok(`override salvato in site_content ("${saved}")`) : fail(`override non salvato (trovato: ${JSON.stringify(saved)})`);

        // The public page must show the edited text.
        await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: "networkidle" });
        const shown = await page.locator("h1").first().innerText();
        shown.includes(marker) ? ok("il testo modificato è live su /s") : fail(`testo non live (h1="${shown}")`);
      }
    }
  } finally {
    // ── restore ──────────────────────────────────────────────────────────
    await sb.from("tenants").update({ settings: originalSettings }).eq("id", tenant.id);
    console.log("\n↩ settings tenant ripristinati");
    await browser.close();
  }

  console.log(failures ? `\n✗ ${failures} FAILURE` : "\n✓ TUTTO VERDE");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
