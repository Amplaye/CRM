// Load test: measure at what level of CONCURRENT conversations the live n8n
// (shared Hostinger instance) starts to degrade. We send single independent
// "hello"-style turns to the bot webhook at increasing concurrency levels and
// measure, per level: webhook HTTP acceptance, bot completion (reply read from
// the execution log), end-to-end latency, and errors.
//
// This is the BEFORE baseline. After we make the webhook async (Phase 1) we
// re-run the same script to prove the improvement.
//
// Run: node scripts/oraz-e2e/loadtest.mjs
//      node scripts/oraz-e2e/loadtest.mjs --levels 1,2,4,8 --gap 20
//
// NOTE: this hits the SHARED n8n. Run it when you accept generating real load.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(__dirname, '../../.env.local'), 'utf8');
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || '').replace(/^["']|["']$/g, '').trim();

const N8N_BASE = pick('N8N_BASE_URL') || 'https://n8n.srv1468837.hstgr.cloud';
const N8N_KEY = pick('N8N_API_KEY');
// Motore unico: every tenant is served by the Picnic engine; the tenant is
// resolved at runtime from body.tenant_id. Defaults hit the engine directly with
// the Oraz tenant (same heavy gpt-5.1 path the old dedicated Oraz workflow had).
// Override via env to target the Meta Router or another tenant.
const WORKFLOW_ID = process.env.LT_WORKFLOW_ID || '166QnQsGHqXDpBxa';
const WEBHOOK_PATH = process.env.LT_WEBHOOK_PATH || 'picnic-whatsapp';
const TENANT_ID = process.env.LT_TENANT_ID || '93eebe9c-8af5-4ca5-a315-3376ef4976e5';

const getArg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const LEVELS = (getArg('--levels', '1,2,4,8,12')).split(',').map((n) => parseInt(n, 10));
const GAP_S = parseInt(getArg('--gap', '25'), 10); // cooldown between levels so the instance recovers
const POLL_MAX = 35; // ~35 * 2.5s = ~87s max wait per reply

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Distinct, harmless single-turn messages — no DB writes, no booking funnel.
const MSGS = [
  '¿A qué hora abrís hoy?', '¿Tenéis sushi?', '¿Dónde estáis?', '¿Aceptáis tarjeta?',
  '¿Tenéis terraza?', '¿Hacéis delivery?', '¿Qué tal el parking?', '¿Sois aptos para celíacos?',
  '¿Cuál es el teléfono?', '¿Tenéis wifi?', '¿Abrís los lunes?', '¿Qué tipo de comida es?',
];

let sidCounter = 0;
async function oneTurn(idx) {
  const sid = `LOAD_${Date.now()}_${++sidCounter}_${idx}`;
  const phone = `whatsapp:+34699${String(100000 + idx).slice(-6)}`;
  const body = MSGS[idx % MSGS.length];
  const t0 = Date.now();
  let acceptMs = null, webhookStatus = null, webhookErr = null;
  try {
    const res = await fetch(`${N8N_BASE}/webhook/${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ From: phone, Body: body, ProfileName: 'LOAD', MessageSid: sid, tenant_id: TENANT_ID }),
    });
    acceptMs = Date.now() - t0;
    webhookStatus = res.status;
  } catch (e) {
    webhookErr = String(e.message || e);
    return { idx, sid, webhookStatus, webhookErr, acceptMs: Date.now() - t0, replied: false, e2eMs: null };
  }
  if (webhookStatus >= 400) return { idx, sid, webhookStatus, acceptMs, replied: false, e2eMs: null };

  // Poll execution log for the reply that carried our SID.
  for (let i = 0; i < POLL_MAX; i++) {
    await sleep(2500);
    let r;
    try {
      r = await fetch(`${N8N_BASE}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=12&includeData=true`, {
        headers: { 'X-N8N-API-KEY': N8N_KEY },
      });
    } catch { continue; }
    if (!r.ok) continue;
    let data; try { data = await r.json(); } catch { continue; }
    for (const ex of data.data || []) {
      let blob; try { blob = JSON.stringify(ex); } catch { continue; }
      if (!blob.includes(sid)) continue;
      // found our execution — did it finish?
      if (ex.status === 'success' || ex.finished) {
        return { idx, sid, webhookStatus, acceptMs, replied: true, e2eMs: Date.now() - t0, exStatus: ex.status };
      }
      if (ex.status === 'error') {
        return { idx, sid, webhookStatus, acceptMs, replied: false, e2eMs: Date.now() - t0, exStatus: 'error' };
      }
    }
  }
  return { idx, sid, webhookStatus, acceptMs, replied: false, e2eMs: Date.now() - t0, exStatus: 'timeout' };
}

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

(async () => {
  console.log(`\n🔥 Oraz n8n LOAD TEST (shared Hostinger instance) — BEFORE baseline`);
  console.log(`   levels: ${LEVELS.join(', ')} concurrent · gap ${GAP_S}s between levels\n`);
  console.log('LEVEL │ accepted │ replied │ errors │ accept ms (avg/p90) │ e2e ms (avg/p90/max)');
  console.log('──────┼──────────┼─────────┼────────┼─────────────────────┼─────────────────────');

  const summary = [];
  let base = 0;
  for (const level of LEVELS) {
    const tasks = [];
    for (let k = 0; k < level; k++) tasks.push(oneTurn(base + k));
    base += level;
    const out = await Promise.all(tasks);

    const accepted = out.filter((o) => o.webhookStatus && o.webhookStatus < 400).length;
    const replied = out.filter((o) => o.replied).length;
    const errors = out.filter((o) => o.webhookErr || (o.webhookStatus && o.webhookStatus >= 400) || o.exStatus === 'error' || o.exStatus === 'timeout').length;
    const acceptMs = out.map((o) => o.acceptMs).filter((x) => x != null);
    const e2e = out.filter((o) => o.replied).map((o) => o.e2eMs);

    const row = {
      level, accepted, replied, errors,
      acceptAvg: avg(acceptMs), acceptP90: pct(acceptMs, 90),
      e2eAvg: avg(e2e), e2eP90: pct(e2e, 90), e2eMax: e2e.length ? Math.max(...e2e) : null,
      detail: out.map((o) => ({ st: o.webhookStatus, ex: o.exStatus, err: o.webhookErr, e2e: o.e2eMs })),
    };
    summary.push(row);
    const f = (x) => (x == null ? '  -  ' : String(x).padStart(5));
    console.log(
      `${String(level).padStart(5)} │ ${String(accepted + '/' + level).padStart(8)} │ ${String(replied + '/' + level).padStart(7)} │ ${String(errors).padStart(6)} │ ${f(row.acceptAvg)} / ${f(row.acceptP90)}      │ ${f(row.e2eAvg)} / ${f(row.e2eP90)} / ${f(row.e2eMax)}`
    );

    if (level !== LEVELS[LEVELS.length - 1]) await sleep(GAP_S * 1000);
  }

  console.log('\nNote: "accept ms" = time for n8n to return HTTP 200 to the webhook (today it');
  console.log('blocks until work is queued). "e2e ms" = until the bot reply is in the exec log.');
  console.log('Degradation = accept latency climbing, errors > 0, or replies missing.\n');

  // machine-readable
  const outPath = join(__dirname, getArg('--out', 'loadtest-engine.json'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, JSON.stringify({ when: new Date().toISOString?.() || Date.now(), levels: summary }, null, 2));
  console.log(`wrote ${outPath}`);
})();
