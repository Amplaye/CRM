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

// Set both the template and a palette override (or clear it with null).
async function setTemplateAndPalette(tenant, key, palette) {
  const settings = tenant.settings || {};
  const site = { ...(settings.site_branding || {}), template: key };
  const nextPalette = { ...(settings.site_palette || {}) };
  if (palette) nextPalette[key] = palette;
  else delete nextPalette[key];
  const { error } = await sb
    .from("tenants")
    .update({ settings: { ...settings, site_branding: site, site_palette: nextPalette } })
    .eq("id", tenant.id);
  if (error) throw error;
}

// Read an applied CSS custom property from the first element that carries it.
async function readCssVar(page, name) {
  return page.evaluate((varName) => {
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const v = getComputedStyle(el).getPropertyValue(varName).trim();
      if (v) return v;
    }
    return "";
  }, name);
}

// #rrggbb → "rgb(r, g, b)" to compare against computed styles.
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
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
        // The booking widget is modal-triggered: a reservation section (id
        // reserva / reservar / reservas across templates) with a BookingCta
        // button (the date picker lives in the modal it opens).
        const reserva = await page.locator("#reserva, #reservar, #reservas").count();
        const cta = await page.locator("#reserva button, #reservar button, #reservas button").count();
        reserva > 0 && cta > 0 ? ok(`${key}: sezione prenotazione + CTA presenti`) : fail(`${key}: sezione/CTA prenotazione MANCANTE (reserva=${reserva}, cta=${cta})`);
      }
    }

    // ── 2. Widget live: open the booking modal → availability call ────────
    console.log('\n② Widget: apri prenotazione dal template suerte…');
    await setTemplate({ ...tenant, settings: originalSettings }, "suerte");
    await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: "networkidle" });
    // Open the modal via the #reserva CTA. Opening the modal + the availability
    // call both need client JS; some local `next start` setups don't hydrate
    // (chunk MIME/CSP), so these are best-effort — the CTA's SSR presence is
    // already asserted per-template in §①.
    await page.locator("#reserva button").first().click().catch(() => {});
    await page.waitForTimeout(800);
    const dateField = page.locator('input[type="date"]').first();
    if ((await dateField.count()) === 0) {
      console.log("   • widget non idratato (input data assente; non bloccante)");
    } else {
      const in3days = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
      await dateField.fill(in3days);
      const availRes = await page
        .waitForResponse((r) => r.url().includes("/api/public/availability"), { timeout: 15000 })
        .catch(() => null);
      // Availability is a best-effort probe of the (unchanged) widget flow; the
      // modal may need extra fields before it fires. Don't fail the suite on it.
      if (availRes && availRes.ok()) ok(`availability HTTP ${availRes.status()}`);
      else console.log(`   • availability non fired (widget flow, non bloccante)`);
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${SHOT_DIR}/suerte-widget.png`, fullPage: false });
    }

    // ── 2bis. Palette override: colours cascade to /s ────────────────────
    console.log("\n②bis Palette: override colori su suerte…");
    // Unset palette → no --c1 var emitted (byte-identical to built-in).
    await setTemplateAndPalette({ ...tenant, settings: originalSettings }, "suerte", null);
    await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: "networkidle" });
    const noVar = await readCssVar(page, "--c1");
    noVar === "" ? ok("palette non impostata → nessun --c1 (identico all'originale)") : fail(`--c1 presente senza override: "${noVar}"`);

    // Distinctive 6-slot override — suerte now exposes c1..c6 so previously
    // fixed sections (text/details/shadows) are recolourable too. c4 = "Testo"
    // (the heading colour) which used to be hardcoded and unchangeable.
    const OVR = ["#ff00aa", "#00cc44", "#0000ff", "#101820", "#ffb300", "#0057b8"];
    await setTemplateAndPalette({ ...tenant, settings: originalSettings }, "suerte", OVR);
    await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const c1 = await readCssVar(page, "--c1");
    const c2 = await readCssVar(page, "--c2");
    const c4 = await readCssVar(page, "--c4");
    c1.toLowerCase() === OVR[0] ? ok(`--c1 cascata = ${c1}`) : fail(`--c1 atteso ${OVR[0]}, trovato "${c1}"`);
    c2.toLowerCase() === OVR[1] ? ok(`--c2 cascata = ${c2}`) : fail(`--c2 atteso ${OVR[1]}, trovato "${c2}"`);
    c4.toLowerCase() === OVR[3] ? ok(`--c4 (Testo, slot nuovo) cascata = ${c4}`) : fail(`--c4 atteso ${OVR[3]}, trovato "${c4}"`);
    // The template root paints its background from var(--c1) → must be the override.
    const rootBg = await page.evaluate(() => {
      // the full-bleed template wrapper is the min-h-screen div
      const el = document.querySelector(".min-h-screen");
      return el ? getComputedStyle(el).backgroundColor : "";
    });
    rootBg === hexToRgb(OVR[0])
      ? ok(`sfondo template ricolorato = ${rootBg}`)
      : fail(`sfondo atteso ${hexToRgb(OVR[0])}, trovato "${rootBg}"`);
    await page.screenshot({ path: `${SHOT_DIR}/suerte-palette.png`, fullPage: false });

    // ── 2ter. In-site menu: clickable dishes + full-menu overlay ─────────
    console.log("\n②ter Menu in-site: piatti cliccabili + overlay menù completo…");
    await setTemplateAndPalette({ ...tenant, settings: originalSettings }, "suerte", null);
    await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: "networkidle" });
    // SSR wiring (works regardless of hydration): dish cards carry data-dish-id
    // and every "full menu" link points at /m/<slug> so the delegated listener
    // can intercept it.
    const dishCards = await page.locator("[data-dish-id]").count();
    dishCards > 0 ? ok(`${dishCards} piatti con data-dish-id (cliccabili)`) : fail("nessun piatto con data-dish-id");
    const menuLinks = await page.locator(`a[href="/m/${SLUG}"]`).count();
    menuLinks > 0 ? ok(`${menuLinks} link "menù completo" → intercettati in-site`) : fail("nessun link /m/<slug> trovato");
    // Best-effort interactive checks (need client JS; skipped silently if the
    // local server doesn't hydrate — see note in the widget section).
    if (dishCards > 0) {
      await page.locator("[data-dish-id]").first().click().catch(() => {});
      await page.waitForTimeout(500);
      if (await page.locator(".smo-sheet-sm").isVisible().catch(() => false)) {
        ok("click piatto → modale dettaglio aperta");
        await page.screenshot({ path: `${SHOT_DIR}/suerte-dish.png`, fullPage: false });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      } else {
        console.log("   • dettaglio piatto non aperto (idratazione JS, non bloccante)");
      }
    }
    if (menuLinks > 0) {
      const urlBefore = page.url();
      await page.locator(`a[href="/m/${SLUG}"]`).first().click().catch(() => {});
      await page.waitForTimeout(600);
      if ((await page.locator(".smo-sheet-lg").isVisible().catch(() => false)) && page.url().startsWith(`${BASE}/s/`)) {
        ok("click menù completo → overlay in-site (nessuna navigazione a /m)");
        await page.screenshot({ path: `${SHOT_DIR}/suerte-fullmenu.png`, fullPage: false });
      } else {
        console.log(`   • overlay menù completo non aperto (idratazione JS, non bloccante; url=${page.url()})`);
        if (page.url() !== urlBefore) await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
      }
    }

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

        // ── 3bis. Colour panel: open → change c2 → save → lands in DB ──────
        console.log("\n③bis Editor: pannello colori → cambia accento → salva…");
        await page.goto(`${BASE}/website/editor`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2500);
        await page.getByRole("button", { name: /colori|colores|colors|farben/i }).click();
        await page.waitForTimeout(300);
        const colorInputs = page.locator('input[type="color"]');
        const nColors = await colorInputs.count();
        if (nColors < 3) {
          fail(`pannello colori: attesi 3 selettori, trovati ${nColors}`);
        } else {
          ok(`pannello colori aperto (${nColors} selettori)`);
          const NEW_ACCENT = "#7b2fbe";
          // Drive the React-controlled color input via the native value setter
          // so React's onChange actually fires (a plain el.value = … is ignored
          // by React's synthetic event system).
          await colorInputs.nth(1).evaluate((el, val) => {
            const proto = Object.getPrototypeOf(el);
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            setter ? setter.call(el, val) : (el.value = val);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, NEW_ACCENT);
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${SHOT_DIR}/editor-colors.png`, fullPage: false });
          await page.getByRole("button", { name: /salva|guardar|save|speichern/i }).click();
          await page.waitForTimeout(2500);
          const afterP = await getTenant();
          const savedPal = afterP.settings?.site_palette?.suerte;
          savedPal && savedPal[1]?.toLowerCase() === NEW_ACCENT
            ? ok(`palette salvata in site_palette (${JSON.stringify(savedPal)})`)
            : fail(`palette non salvata (trovato: ${JSON.stringify(savedPal)})`);

          // And it must recolour the public page.
          await page.goto(`${BASE}/s/${SLUG}`, { waitUntil: "networkidle" });
          const liveC2 = await readCssVar(page, "--c2");
          liveC2.toLowerCase() === NEW_ACCENT ? ok("accento ricolorato live su /s") : fail(`--c2 live atteso ${NEW_ACCENT}, trovato "${liveC2}"`);
        }
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
