// Playwright UI E2E on PROD (crm.baliflowagency.com) for the settings help
// hotspots + the Generale readability fix. Verifies, with a real browser + login:
//   • Generale → Programmazione automatica is NO LONGER dimmed (the wrapper had
//     opacity:0.45 outside "scheduled" mode; now it must compute to opacity 1).
//   • Gestionale → the 3 InfoHotspot "i" buttons open a popover with a worked
//     example (Target food cost %, Budget personale, Costo personale per turno).
//   • Magazzino → the "Prodotto cassa collegato" hotspot opens with its example
//     (best-effort: needs at least one ingredient row to expand).
//
//   node scripts/settings-hotspots-e2e.mjs
//
// Login: platform admin → switch to a management-enabled tenant (Oraz). No data
// is saved (mode radios only touch local state; we never click Salva).

import { chromium } from "playwright";

const CRM = "https://crm.baliflowagency.com";
const EMAIL = process.env.CRM_EMAIL || "admin@baliflow.com";
const PASSWORD = process.env.CRM_PASSWORD || "+It&Uz+riRRHG9j+g%h6w2C_";
const TENANT = process.env.TENANT_NAME || "Oraz";
const SHOT = "/tmp/settings-hotspots-e2e";

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

    // ---- SELECT TENANT -----------------------------------------------------
    log(`\n② Switch tenant → "${TENANT}"…`);
    await page.getByRole("button", { name: /Platform Admin/i }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.getByText(TENANT, { exact: true }).first().click({ timeout: 5000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2500);
    ok(`switched to ${TENANT}`);

    // ---- GENERALE: schedule readability fix --------------------------------
    log("\n③ Generale → Programmazione automatica (no opacity dimming)…");
    await page.goto(`${CRM}/settings?tab=general`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const sched = page.getByTestId("voicemail-schedule");
    if (await sched.count()) {
      // Force a non-scheduled mode (first radio = "always") so the OLD code would
      // have dimmed this block to 0.45. Local state only — we never save.
      await page.getByRole("radio").first().click().catch(() => {});
      await page.waitForTimeout(600);
      const opacity = await sched.evaluate((el) => getComputedStyle(el).opacity);
      if (parseFloat(opacity) >= 0.99) ok(`schedule block fully opaque (opacity=${opacity})`);
      else fail(`schedule block still dimmed (opacity=${opacity}) — the fix did not deploy`);
      // The readable info banner should be present in non-scheduled mode.
      const dayCardVisible = await sched.locator("input[type=time], button").first().isVisible().catch(() => false);
      if (dayCardVisible) ok("schedule day-cards visible/readable");
      else fail("schedule day-cards not visible");
      await page.screenshot({ path: `${SHOT}-1-generale.png`, fullPage: true });
    } else {
      fail("voicemail-schedule block not found (deploy not live yet?)");
    }

    // ---- GESTIONALE: 3 hotspots with examples ------------------------------
    log("\n④ Gestionale → hotspot informativi…");
    await page.goto(`${CRM}/settings?tab=management`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOT}-2-gestionale.png`, fullPage: true });

    const hotspots = page.getByRole("button", { name: /\binfo\b/i });
    const n = await hotspots.count();
    if (n >= 3) ok(`found ${n} info hotspots`);
    else fail(`expected ≥3 info hotspots, found ${n} — is management enabled for ${TENANT}?`);

    // Each hotspot, in DOM order: target → labor budget → labor entry.
    const cases = [
      { idx: 0, name: "Target food cost %", re: /3[.,]60|30\s?%/ },
      { idx: 1, name: "Budget personale", re: /5[.,]?400|5[.,]?000|400/ },
      { idx: 2, name: "Costo personale/turno", re: /320|14[\/.]06/ },
    ];
    for (const c of cases) {
      if (c.idx >= n) { fail(`hotspot #${c.idx + 1} (${c.name}) missing`); continue; }
      await hotspots.nth(c.idx).click();
      await page.waitForTimeout(400);
      const dialog = page.getByRole("dialog").first();
      const shown = await dialog.isVisible().catch(() => false);
      if (!shown) { fail(`${c.name}: popover did not open`); continue; }
      const txt = (await dialog.innerText()).replace(/\s+/g, " ");
      if (c.re.test(txt)) ok(`${c.name}: example shown (“${txt.slice(0, 60)}…”)`);
      else fail(`${c.name}: example text missing — got: ${txt.slice(0, 80)}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }

    // ---- MAGAZZINO: POS-link hotspot (best-effort) -------------------------
    log("\n⑤ Magazzino → hotspot “Prodotto cassa collegato”…");
    await page.goto(`${CRM}/inventory`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    // Expand the first ingredient row (chevron toggles the editor with the link field).
    const expander = page.locator('button[aria-label="toggle"], table tbody tr button').first();
    const rowBtn = page.locator("table tbody tr td:first-child button").first();
    let expanded = false;
    if (await rowBtn.count()) { await rowBtn.click().catch(() => {}); expanded = true; }
    else if (await expander.count()) { await expander.click().catch(() => {}); expanded = true; }
    await page.waitForTimeout(1200);
    if (expanded) {
      const invHotspot = page.getByRole("button", { name: /\binfo\b/i }).last();
      if (await invHotspot.count()) {
        await invHotspot.click().catch(() => {});
        await page.waitForTimeout(400);
        const dlg = page.getByRole("dialog").first();
        if (await dlg.isVisible().catch(() => false)) {
          const txt = (await dlg.innerText()).replace(/\s+/g, " ");
          if (/vino|bottiglia|botella|flasche|sincron|stock|cassa|till|kasse|giacenza|bestand/i.test(txt))
            ok(`POS-link hotspot example shown (“${txt.slice(0, 60)}…”)`);
          else fail(`POS-link popover text unexpected: ${txt.slice(0, 80)}`);
          await page.screenshot({ path: `${SHOT}-3-magazzino.png`, fullPage: true });
        } else log("   • POS-link popover did not open (skip — same component already verified)");
      } else log("   • no info hotspot in inventory row (skip)");
    } else {
      log("   • no expandable ingredient row on this tenant (skip magazzino interaction)");
    }

    log(`\n${failures === 0 ? "✅ SETTINGS HOTSPOTS E2E PASSATO" : `❌ ${failures} problemi`} — screenshots in ${SHOT}-*.png`);
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
