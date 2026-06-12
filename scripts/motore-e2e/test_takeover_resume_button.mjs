#!/usr/bin/env node
/**
 * E2E (Playwright, REAL UI): the actual "Completa col bot" button.
 *
 * The Python takeover suites mirror the resume by PATCHing the DB directly,
 * because /api/conversations/resume-bot is cookie-auth + RLS-gated and a
 * service-role script can't drive it (RLS hides the guest → 404). This test
 * exercises the GENUINE production path instead:
 *
 *   1. Arm a HOLD on a uniquely-named guest via /api/webhooks/owner-echo.
 *   2. Log in to PROD as the Picnic admin, open the held conversation.
 *   3. Assert the amber "Titolare al telefono" banner + "Completa col bot".
 *   4. CLICK the real button → assert the banner clears AND the DB hold clears
 *      (bot_paused_hold=false, bot_paused_at=null) — the real endpoint ran.
 *   5. RE-ARM the hold, reopen, and DOUBLE-CLICK the button fast → no crash,
 *      hold still cleanly cleared (idempotency of the real handler).
 *   6. After the real resume, send one engine message as the customer and
 *      assert the bot REPLIES (not skip) — proves the live path re-armed the
 *      conversation end-to-end (clear + retrigger).
 *
 * Runs against PROD (no Next dev server — that's forbidden here). Headed
 * Chromium to pass the Vercel Security Checkpoint; no aggressive polling.
 *
 * Run: node scripts/motore-e2e/test_takeover_resume_button.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = '/Users/amplaye/CRM/.env.local';

function loadEnv() {
  const e = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?/);
    if (m) e[m[1]] = m[2];
  }
  return e;
}
const ENV = loadEnv();
const SB = ENV['NEXT_PUBLIC_SUPABASE_URL'];
const SRK = ENV['SUPABASE_SERVICE_ROLE_KEY'];
const AI = ENV['AI_WEBHOOK_SECRET'];

const CRM = 'https://crm.baliflowagency.com';
const PICNIC = '626547ff-bc44-4f35-8f42-0e97f1dcf0d5';
// Unique, recognizable identity so we can find the row and never collide with
// the Python suites' numbers (last-9-digit fuzzy match).
const RID = process.pid.toString(36).slice(-4);
const PHONE = '+34694500' + String(100 + (process.pid % 800)).padStart(3, '0'); // e.g. +34694500342
const GUEST_NAME = 'E2E PW Takeover ' + RID;

// CRM admin login (Picnic admin). Allow env override; fall back to the known
// rotated credential.
const LOGIN_EMAIL = ENV['E2E_CRM_EMAIL'] || 'picnic@baliflow.com';
const LOGIN_PASS = ENV['E2E_CRM_PASSWORD'] || 'pFW#SBZP#O=ev%3Nj0wZ1EWu';

// ---- tiny REST helpers (service role) ---------------------------------------
async function sb(path, method = 'GET', body) {
  const res = await fetch(SB + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: SRK,
      Authorization: 'Bearer ' + SRK,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  try { return { status: res.status, json: JSON.parse(txt) }; }
  catch { return { status: res.status, json: txt }; }
}

function digits9(p) { return (p || '').replace(/\D/g, '').slice(-9); }

async function findGuest() {
  const d = digits9(PHONE);
  const { json } = await sb(`guests?tenant_id=eq.${PICNIC}&select=id,phone,name,bot_paused_at,bot_paused_hold`);
  if (!Array.isArray(json)) return null;
  return json.find(g => digits9(g.phone) === d) || null;
}

async function cleanup() {
  const g = await findGuest();
  if (!g) return;
  await sb(`conversations?guest_id=eq.${g.id}`, 'DELETE');
  await sb(`reservations?guest_id=eq.${g.id}`, 'DELETE');
  await sb(`guests?id=eq.${g.id}`, 'DELETE');
}

async function ownerEcho(text) {
  const res = await fetch(CRM + '/api/webhooks/owner-echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ai-secret': AI },
    body: JSON.stringify({ tenant_id: PICNIC, guest_phone: PHONE, owner_text: text, guest_name: GUEST_NAME }),
  });
  return { status: res.status, body: await res.text() };
}

// Drive ONE engine message as the customer via the Python harness (reuses the
// execution-polling logic) and return {skip, reply}. Keeps this file from
// re-implementing the n8n poll.
function engineSend(body) {
  const r = spawnSync('python3', [join(__dirname, 'send.py'), PICNIC, 'whatsapp:' + PHONE, body], {
    encoding: 'utf8', timeout: 120000,
  });
  try {
    const out = JSON.parse(r.stdout.trim());
    return out;
  } catch {
    return { ok: false, raw: (r.stdout || '') + (r.stderr || '') };
  }
}

// ---- assertions -------------------------------------------------------------
const PASS = [], FAIL = [];
function check(name, cond, extra = '') {
  (cond ? PASS : FAIL).push([name, extra]);
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? `  [${extra}]` : ''));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function openConversation(page) {
  // Navigate fresh to the conversations page and click the row with our guest
  // name. Retry a little: the realtime/poll list can take a beat to include a
  // just-created conversation.
  await page.goto(CRM + '/conversations', { waitUntil: 'networkidle' });
  const row = page.locator('span.font-bold', { hasText: GUEST_NAME }).first();
  for (let i = 0; i < 12; i++) {
    if (await row.count()) break;
    await sleep(2000);
    await page.reload({ waitUntil: 'networkidle' });
  }
  if (!(await row.count())) throw new Error('conversation row for ' + GUEST_NAME + ' not found');
  await row.click();
  // wait for the detail pane to mount
  await page.waitForTimeout(800);
}

async function main() {
  console.log('=== REAL "Completa col bot" button E2E (Playwright, PROD) ===');
  console.log('    guest:', GUEST_NAME, '| phone:', PHONE);
  await cleanup();

  // 1) arm the hold via owner-echo (creates the guest + conversation).
  const e1 = await ownerEcho('Hola, le atiendo yo personalmente un momento 🙂');
  check('owner-echo armato (200)', e1.status === 200, `http=${e1.status} ${e1.body.slice(0, 100)}`);
  let g = await findGuest();
  check('hold attivo nel DB (bot_paused_hold=true)', !!(g && g.bot_paused_hold), `hold=${g && g.bot_paused_hold}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: 'it-IT',
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // 2) log in to prod as the admin.
    await page.goto(CRM + '/login', { waitUntil: 'networkidle' });
    await page.fill('#email', LOGIN_EMAIL);
    await page.fill('#password', LOGIN_PASS);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(1500);
    const loggedIn = !page.url().includes('/login');
    check('login admin riuscito (fuori da /login)', loggedIn, page.url());
    if (!loggedIn) {
      const err = await page.locator('.bg-red-50\\/80, [class*="bg-red-50"]').first().textContent().catch(() => '');
      throw new Error('login failed: ' + (err || 'unknown'));
    }

    // 3) open the held conversation; assert the banner + button.
    await openConversation(page);
    const banner = page.getByText('Titolare al telefono', { exact: false }).first();
    const resumeBtn = page.getByRole('button', { name: /Completa col bot/i }).first();
    const bannerVisible = await banner.isVisible().catch(() => false);
    check('banner "Titolare al telefono" visibile', bannerVisible);
    const btnVisible = await resumeBtn.isVisible().catch(() => false);
    check('bottone "Completa col bot" visibile', btnVisible);

    // 4) CLICK the real button → banner clears + DB hold clears (real endpoint ran).
    // Watch the actual network call to be sure it was the production route.
    const respP = page.waitForResponse(
      (r) => r.url().includes('/api/conversations/resume-bot') && r.request().method() === 'POST',
      { timeout: 20000 }
    ).catch(() => null);
    await resumeBtn.click();
    const resp = await respP;
    check('chiamata reale a /api/conversations/resume-bot (200)', !!resp && resp.status() === 200,
      resp ? `status=${resp.status()}` : 'no response observed');
    // banner should disappear
    await banner.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    const bannerGone = !(await banner.isVisible().catch(() => false));
    check('banner sparito dopo il click', bannerGone);
    // DB reflects the cleared hold
    await sleep(1500);
    g = await findGuest();
    check('DB: hold pulito dal bottone reale (bot_paused_hold=false, paused_at=null)',
      !!g && g.bot_paused_hold === false && g.bot_paused_at === null,
      `hold=${g && g.bot_paused_hold} paused_at=${g && g.bot_paused_at}`);

    // 5) RE-ARM and DOUBLE-CLICK fast → no crash, hold cleanly cleared (idempotency).
    const e2 = await ownerEcho('Una última cosa, ahora cierro yo…');
    check('hold ri-armato per il test doppio-click (200)', e2.status === 200, `http=${e2.status}`);
    await sleep(800);
    await openConversation(page);
    const resumeBtn2 = page.getByRole('button', { name: /Completa col bot/i }).first();
    const reBtnVisible = await resumeBtn2.isVisible().catch(() => false);
    check('bottone di nuovo visibile dopo il re-arm', reBtnVisible);
    if (reBtnVisible) {
      // fire two clicks in quick succession; the button may detach after the
      // first (banner clears), so the 2nd is best-effort and must not throw.
      await resumeBtn2.click().catch(() => {});
      await resumeBtn2.click({ timeout: 1500 }).catch(() => {});
    }
    await sleep(2500);
    g = await findGuest();
    check('doppio-click: nessun crash, hold comunque pulito', !!g && g.bot_paused_hold === false,
      `hold=${g && g.bot_paused_hold}`);
    // page is still alive / responsive
    const stillUp = await page.getByRole('button', { name: /Completa col bot/i }).count();
    check('UI ancora viva dopo il doppio-click (nessun banner-hold residuo)', stillUp === 0, `holdButtons=${stillUp}`);

    // 6) after the real resume, the customer's next engine message gets a reply.
    console.log('  … invio un messaggio cliente al motore per provare la ripresa reale');
    const r = engineSend('Vale, entonces ¿me confirmáis la mesa?');
    check('dopo la ripresa reale il bot RISPONDE al cliente (non skip)',
      r.ok && r.skip !== true && !!(r.reply && r.reply.length),
      `skip=${r.skip} reply=${JSON.stringify((r.reply || '').slice(0, 60))}`);
  } finally {
    await browser.close().catch(() => {});
    await cleanup();
  }

  console.log(`\n=== ${PASS.length} passed, ${FAIL.length} failed ===`);
  if (FAIL.length) {
    for (const [n, e] of FAIL) console.log('  FAIL:', n, '|', e);
    process.exit(1);
  }
  console.log('ALL GREEN ✅');
}

main().catch((e) => {
  console.error('FATAL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
