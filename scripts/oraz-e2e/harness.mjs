// Oraz WhatsApp bot (Sofía) — true end-to-end harness.
//
// Drives the LIVE n8n workflow `[Oraz] Chatbot WhatsApp` (id zXEYdw8Zbs5seCci)
// exactly as a real customer texting via Meta would: it POSTs {From,Body,...}
// to the production webhook, then reads Sofía's actual gpt-5.1 reply back out
// of the n8n execution log (the Meta delivery to a fake number is irrelevant —
// the generated text is logged regardless). Multi-turn: same `From` across
// posts so the bot rebuilds history from Supabase and the turns chain.
//
// One scenario == one CRM "function". Each scenario asserts on the bot's reply
// per turn. The driver runs N rounds per function and reports a pass-rate; the
// goal is 100% on every function (no more "lottery").
//
// Usage:
//   node scripts/oraz-e2e/harness.mjs                # all functions, 5 rounds
//   node scripts/oraz-e2e/harness.mjs --rounds 3
//   node scripts/oraz-e2e/harness.mjs --only booking,menu
//   node scripts/oraz-e2e/harness.mjs --cleanup      # only purge test data
//
// Reads N8N_BASE_URL / N8N_API_KEY from CRM/.env.local.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRM_ROOT = path.resolve(__dirname, '..', '..');

// ---------- config ----------
// Defaults target Oraz; override via env to test another tenant on the same
// shared engine (e.g. Picnic): ORAZ_WORKFLOW_ID / ORAZ_WEBHOOK_PATH / ORAZ_TENANT_ID.
const WORKFLOW_ID = process.env.ORAZ_WORKFLOW_ID || 'zXEYdw8Zbs5seCci';
const WEBHOOK_PATH = process.env.ORAZ_WEBHOOK_PATH || 'oraz-93ee-whatsapp';
const TENANT_ID = process.env.ORAZ_TENANT_ID || '93eebe9c-8af5-4ca5-a315-3376ef4976e5';
const SUPA_URL = 'https://azhlnybiqlkbhbboyvud.supabase.co/rest/v1';
// Test numbers all share this prefix so cleanup is a single LIKE filter.
const TEST_PREFIX = '34699';

function loadEnv() {
  const env = {};
  const raw = fs.readFileSync(path.join(CRM_ROOT, '.env.local'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  // Supabase service-role key is embedded in the workflow's Send node.
  // Prefer the TRUE live pull; fall back to the local snapshot.
  const wfPath = fs.existsSync(path.join(CRM_ROOT, 'N8N/picnic/live_oraz.TRUE.json'))
    ? 'N8N/picnic/live_oraz.TRUE.json'
    : 'N8N/picnic/live_oraz.json';
  const wf = JSON.parse(fs.readFileSync(path.join(CRM_ROOT, wfPath), 'utf8'));
  const sendCode = wf.nodes.find((n) => n.name === 'Send WhatsApp Reply').parameters.jsCode;
  const sk = sendCode.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  env.SUPA_SERVICE_KEY = sk ? sk[0] : '';
  return env;
}
const ENV = loadEnv();
const N8N_BASE = ENV.N8N_BASE_URL || 'https://n8n.srv1468837.hstgr.cloud';
const N8N_KEY = ENV.N8N_API_KEY;
const SK = ENV.SUPA_SERVICE_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const has = (reply, ...words) => words.some((w) => norm(reply).includes(norm(w)));
const hasAll = (reply, ...words) => words.every((w) => norm(reply).includes(norm(w)));

// ---------- one round-trip turn against the live bot ----------
let sidCounter = 0;
async function sendTurn(phone, body, profileName = 'E2E') {
  const sid = `E2E_${Date.now()}_${++sidCounter}`;
  // The self-hosted n8n occasionally returns a transient 5xx (502/503/504) under
  // load. That is infra noise, not a bot failure — retry the POST a few times
  // with backoff before giving up so a blip doesn't fail an otherwise-good run.
  let res;
  for (let tryN = 0; tryN < 4; tryN++) {
    try {
      res = await fetch(`${N8N_BASE}/webhook/${WEBHOOK_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ From: `whatsapp:+${phone}`, Body: body, ProfileName: profileName, MessageSid: sid }),
      });
    } catch (e) {
      if (tryN === 3) throw e;
      await sleep(800 * (tryN + 1));
      continue;
    }
    if (res.ok) break;
    if (res.status >= 500 && tryN < 3) { await sleep(800 * (tryN + 1)); continue; }
    throw new Error(`webhook HTTP ${res.status}`);
  }

  // Poll the execution log for the run that carried our SID.
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(2500);
    const r = await fetch(`${N8N_BASE}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=6&includeData=true`, {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
    });
    if (!r.ok) continue;
    const data = await r.json();
    for (const ex of data.data || []) {
      const blob = JSON.stringify(ex);
      if (!blob.includes(sid)) continue;
      if (ex.status !== 'success' && ex.status !== 'error' && !ex.finished) break; // still running
      const out = nodeOutput(ex, 'Process AI Response') || nodeOutput(ex, 'Send WhatsApp Reply') || nodeOutput(ex, 'OpenAI');
      let reply = (out && (out.cleanResponse ?? out.aiResponse)) || '';
      // Skip-path replies (cancel intent, reset, modify-trigger, pending recap)
      // are sent DIRECTLY from the Fetch node via sendWhatsApp() and then the
      // node returns {skip:true}. Those never populate cleanResponse — so when
      // the LLM reply is empty, recover the actual outgoing WhatsApp text from
      // the Meta/Twilio httpRequest bodies captured in the execution log.
      if (!reply) reply = extractOutgoingWhatsApp(ex);
      const sendOut = nodeOutput(ex, 'Send WhatsApp Reply') || {};
      return {
        sid,
        execId: ex.id,
        status: ex.status,
        reply,
        // Context the bot actually had — lets assertions check ground truth.
        availabilityInfo: out?.availabilityInfo,
        scheduleInfo: out?.scheduleInfo,
        calendarBlock: out?.calendarBlock,
        existingReservations: out?.existingReservations,
        bookingData: sendOut.bookingData,
        modifyData: sendOut.modifyData,
        waitlistData: sendOut.waitlistData,
        zoneCount: out?.zoneCount,
        lang: out?.lang,
      };
    }
  }
  throw new Error(`no execution found for sid ${sid} (bot may be down or too slow)`);
}

function nodeOutput(ex, name) {
  try {
    return ex.data.resultData.runData[name][0].data.main[0][0].json;
  } catch {
    return null;
  }
}

// Recover a reply sent DIRECTLY via sendWhatsApp() inside the Fetch node
// (skip-path: cancel/reset/modify-trigger). n8n captures each httpRequest the
// node makes; the Meta text body lives at text.body, Twilio at Body=. We scan
// the whole execution blob for the last meaningful outgoing WhatsApp text.
function extractOutgoingWhatsApp(ex) {
  const blob = JSON.stringify(ex);
  const found = [];
  // Meta: "text":{"body":"..."}
  const meta = blob.matchAll(/"text"\s*:\s*\{\s*"body"\s*:\s*"((?:[^"\\]|\\.){2,1200})"/g);
  for (const m of meta) found.push(decodeJsonStr(m[1]));
  // Plain "body":"..." (some helpers) — only if it looks like a sentence
  const plain = blob.matchAll(/"body"\s*:\s*"((?:[^"\\]|\\.){8,1200})"/g);
  for (const m of plain) {
    const s = decodeJsonStr(m[1]);
    if (/[ .,?!¿¡]/.test(s) && !/^https?:/.test(s)) found.push(s);
  }
  // Twilio form-encoded: Body=...
  const tw = blob.matchAll(/Body=([^"&]{8,1200})/g);
  for (const m of tw) { try { found.push(decodeURIComponent(m[1].replace(/\+/g, ' '))); } catch {} }
  // Prefer the longest distinct human-looking message (the actual reply).
  const uniq = [...new Set(found)].filter((s) => s && s.trim().length > 2);
  uniq.sort((a, b) => b.length - a.length);
  return uniq[0] || '';
}

function decodeJsonStr(s) {
  try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch { return s; }
}

// fresh unique phone per conversation so history never bleeds across cases/rounds
function freshPhone() {
  const n = String(Math.floor(Date.now() % 100000) + sidCounter).padStart(5, '0').slice(-5);
  return `${TEST_PREFIX}${n}`;
}

// ---------- Supabase helper (seed/cleanup test data directly) ----------
async function supaReq(method, pathq, body) {
  const res = await fetch(`${SUPA_URL}/${pathq}`, {
    method,
    headers: {
      apikey: SK,
      Authorization: `Bearer ${SK}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = JSON.parse(await res.text()); } catch {}
  return { ok: res.ok, status: res.status, json };
}

// Seed a REAL confirmed reservation for `phone` (the WhatsApp card can't be
// button-tapped from the harness, so modify/cancel scenarios need a row that
// already exists). Returns { guestId, reservationId, date, time, party }.
async function seedReservation(phone, { date, time = '21:00', party = 2, name = 'Test E2E' } = {}) {
  // today (Atlantic/Canary) in YYYY-MM-DD if no date given
  const d = date || new Date(Date.now() + 26 * 3600 * 1000).toISOString().slice(0, 10); // ~tomorrow, tz-safe-ish
  const g = await supaReq('POST', 'guests', {
    tenant_id: TENANT_ID, name, phone, visit_count: 0,
  });
  const guestId = g.json?.[0]?.id;
  if (!guestId) throw new Error(`seed guest failed: ${JSON.stringify(g.json)}`);
  const r = await supaReq('POST', 'reservations', {
    tenant_id: TENANT_ID, guest_id: guestId, date: d, time, party_size: party,
    status: 'confirmed', source: 'ai_chat', created_by_type: 'ai',
  });
  const reservationId = r.json?.[0]?.id;
  if (!reservationId) throw new Error(`seed reservation failed: ${JSON.stringify(r.json)}`);
  return { guestId, reservationId, date: d, time, party };
}

// ---------- scenario runner ----------
// A scenario is { id, name, run: async (ctx) => [{check, ok, detail}] }
// ctx.say(text) sends a turn and returns the result object.
async function runScenario(scn) {
  const phone = freshPhone();
  const checks = [];
  const ctx = {
    phone,
    say: (text, profile) => sendTurn(phone, text, profile),
    assert: (label, cond, detail = '') => checks.push({ label, ok: !!cond, detail }),
  };
  try {
    await scn.run(ctx);
  } catch (e) {
    checks.push({ label: 'scenario-threw', ok: false, detail: e.message });
  }
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  return { ok, checks, phone };
}

export { sendTurn, runScenario, freshPhone, seedReservation, supaReq, has, hasAll, ENV, SK, SUPA_URL, TENANT_ID, TEST_PREFIX, sleep, N8N_BASE, WORKFLOW_ID };
