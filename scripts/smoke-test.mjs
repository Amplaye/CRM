#!/usr/bin/env node
// Picnic — automated smoke test (Tier 0 del backlog 2026-05-12).
//
// Esegue 7 verifiche end-to-end senza intervento umano. Output:
// PASS/FAIL per ciascuna + riepilogo. exit 1 se anche una sola fallisce.
//
// Usage:  node scripts/smoke-test.mjs
//
// Env override:
//   CRM_URL                 (default https://crm.baliflowagency.com)
//   AI_WEBHOOK_SECRET       (required for 0.7)
//   N8N_API_KEY             (required for 0.2)
//   SUPABASE_MGMT_TOKEN     (required for 0.3 / cleanup)

import { spawnSync } from 'node:child_process';

const CRM_URL = process.env.CRM_URL || 'https://crm.baliflowagency.com';
const N8N_BASE = process.env.N8N_BASE_URL || 'https://n8n.srv1468837.hstgr.cloud';
const N8N_API_KEY = process.env.N8N_API_KEY || '';
const SB_PROJECT_REF = process.env.SB_PROJECT_REF || 'azhlnybiqlkbhbboyvud';
const SB_MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN || '';
const AI_SECRET = process.env.AI_WEBHOOK_SECRET || '';
const TENANT_PICNIC = process.env.PICNIC_TENANT_ID || '626547ff-bc44-4f35-8f42-0e97f1dcf0d5';
// Real tenant_api_keys row, used to verify /api/webhooks Bearer auth post-1.4.
const SMOKE_API_KEY = process.env.SMOKE_API_KEY || '';

// Pre-flight: tutti i secret runtime devono essere passati via env.
for (const [k, v] of Object.entries({
  N8N_API_KEY,
  SUPABASE_MGMT_TOKEN: SB_MGMT_TOKEN,
  AI_WEBHOOK_SECRET: AI_SECRET,
  SMOKE_API_KEY,
})) {
  if (!v) {
    console.error(`[smoke] missing env ${k}. Set it (e.g. via vercel env pull) and retry.`);
    process.exit(2);
  }
}
const SMOKE_PHONE_RAW = '+34900000000';            // numero invalido → Twilio rifiuta
const SMOKE_PHONE_WHATSAPP = 'whatsapp:+34900000000';

// -------- helpers --------
const results = [];
function record(id, label, ok, detail = '') {
  results.push({ id, label, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  const line = `${id.padEnd(3)} ${label.padEnd(22)} ${tag}${detail ? ' — ' + detail : ''}`;
  console.log(line);
}

async function runSql(sql) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${SB_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SB_MGMT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`SQL HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function runCmd(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', cwd: process.cwd() });
  return {
    ok: r.status === 0,
    out: (r.stdout?.toString() || '') + (r.stderr?.toString() || ''),
  };
}

// -------- 0.1: build + tests --------
async function test01() {
  const build = runCmd('npm', ['run', 'build']);
  if (!build.ok) {
    const tail = build.out.split('\n').slice(-6).join(' | ').slice(0, 280);
    record('0.1', 'build + tests', false, `build: ${tail}`);
    return;
  }
  const test = runCmd('npm', ['test']);
  if (!test.ok) {
    const tail = test.out.split('\n').slice(-6).join(' | ').slice(0, 280);
    record('0.1', 'build + tests', false, `test: ${tail}`);
    return;
  }
  // Estrai numero test passati
  const m = test.out.match(/Tests\s+([0-9]+)\s+passed/i);
  record('0.1', 'build + tests', true, m ? `${m[1]} test passed` : 'all green');
}

// -------- 0.2: workflow n8n attivi --------
async function test02() {
  try {
    const r = await fetch(`${N8N_BASE}/api/v1/workflows?limit=250`, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const required = [
      '[Picnic] Chatbot WhatsApp',
      '[Picnic] Voice Agent Webhooks',
      '[Picnic] Reminders',
      '[Picnic] No-Show Auto-Cancel',
    ];
    const byName = new Map((j.data || []).map((w) => [w.name, w]));
    const missing = required.filter((n) => !byName.get(n)?.active);
    if (missing.length) {
      record('0.2', 'n8n workflows', false, `inattivi/mancanti: ${missing.join(', ')}`);
    } else {
      record('0.2', 'n8n workflows', true, `${required.length}/${required.length} attivi`);
    }
  } catch (e) {
    record('0.2', 'n8n workflows', false, e.message);
  }
}

// -------- 0.3: nessun errore recente in system_logs --------
async function test03() {
  try {
    const j = await runSql(
      `SELECT count(*)::int AS n FROM system_logs
       WHERE severity IN ('high','critical')
         AND status = 'open'
         AND created_at > now() - interval '2 hours';`
    );
    const n = j?.[0]?.n ?? 0;
    if (n === 0) {
      record('0.3', 'system_logs', true, '0 errors last 2h');
    } else {
      const titles = await runSql(
        `SELECT title FROM system_logs
         WHERE severity IN ('high','critical') AND status='open'
           AND created_at > now() - interval '2 hours'
         ORDER BY created_at DESC LIMIT 3;`
      );
      record('0.3', 'system_logs', false, `${n} aperti — ${titles.map((t) => t.title).join(' / ')}`);
    }
  } catch (e) {
    record('0.3', 'system_logs', false, e.message);
  }
}

// -------- 0.4: dedup MessageSid --------
async function test04() {
  const messageSid = `SM_smoke_dedup_${Date.now()}`;
  const phone = `+34900000${Math.floor(Math.random() * 900 + 100)}`; // cleanup-able
  const body = {
    tenant_id: TENANT_PICNIC,
    guest_phone: phone,
    guest_name: 'SMOKE TEST',
    channel: 'whatsapp',
    message_sid: messageSid,
    intent: 'unknown',
    sentiment: 'neutral',
    summary: 'smoke dedup',
    transcript: [{ role: 'user', text: 'smoke', ts: new Date().toISOString() }],
  };

  try {
    const r1 = await fetch(`${CRM_URL}/api/webhooks/incoming-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j1 = await r1.json();
    const r2 = await fetch(`${CRM_URL}/api/webhooks/incoming-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j2 = await r2.json();

    const ok =
      r1.ok &&
      r2.ok &&
      ['created', 'updated'].includes(j1.action) &&
      j2.action === 'deduped';

    if (!ok) {
      record(
        '0.4',
        'dedup MessageSid',
        false,
        `r1=${j1.action || JSON.stringify(j1).slice(0, 80)} r2=${j2.action || JSON.stringify(j2).slice(0, 80)}`
      );
    } else {
      record('0.4', 'dedup MessageSid', true, `${j1.action} → deduped`);
    }

    // Cleanup
    const convId = j1.conversation_id;
    if (convId) {
      await runSql(`DELETE FROM audit_events WHERE entity_id = '${convId}';`);
      await runSql(`DELETE FROM conversations WHERE id = '${convId}';`);
    }
    await runSql(
      `DELETE FROM guests WHERE tenant_id = '${TENANT_PICNIC}' AND phone = '${phone}';`
    );
  } catch (e) {
    record('0.4', 'dedup MessageSid', false, e.message);
  }
}

// -------- 0.5: tenant API key lookup --------
async function test05() {
  try {
    // (a) real api-key (tenant_api_keys row) → atteso !401
    const r1 = await fetch(`${CRM_URL}/api/webhooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SMOKE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: `smoke-${Date.now()}`,
        type: 'voice.ingest',
        payload: { smoke: true },
      }),
    });
    // (b) chiave invalida → atteso 401
    const r2 = await fetch(`${CRM_URL}/api/webhooks`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer chiave-finta-non-esistente-smoke',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        idempotency_key: `smoke-${Date.now()}`,
        type: 'voice.ingest',
        payload: { smoke: true },
      }),
    });

    const ok = r1.status !== 401 && r2.status === 401;
    if (!ok) {
      record('0.5', 'api-key lookup', false, `real=${r1.status} invalid=${r2.status}`);
    } else {
      record('0.5', 'api-key lookup', true, `real=${r1.status} invalid=401`);
    }

    // Cleanup webhook_events smoke
    await runSql(
      `DELETE FROM webhook_events WHERE tenant_id = '${TENANT_PICNIC}' AND payload->>'smoke' = 'true';`
    );
  } catch (e) {
    record('0.5', 'api-key lookup', false, e.message);
  }
}

// -------- 0.6: smoke E2E chatbot (simulazione Twilio) --------
async function test06() {
  const messageSid = `SM_smoke_e2e_${Date.now()}`;
  const formData = new URLSearchParams({
    Body: 'hola, quiero info sobre el horario',
    From: SMOKE_PHONE_WHATSAPP,
    ProfileName: 'SMOKE TEST',
    MessageSid: messageSid,
    To: 'whatsapp:+14155238886',
  });

  try {
    const r = await fetch(`${N8N_BASE}/webhook/picnic-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });
    if (!r.ok) {
      record('0.6', 'E2E chatbot', false, `n8n HTTP ${r.status}`);
      return;
    }

    // Aspetta che il workflow giri (Parser → Controller → Formatter ≈ 5-15s)
    let conv = null;
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      const rows = await runSql(
        `SELECT c.id, c.transcript, c.created_at, g.phone
         FROM conversations c
         JOIN guests g ON g.id = c.guest_id
         WHERE c.tenant_id = '${TENANT_PICNIC}'
           AND g.phone LIKE '%${SMOKE_PHONE_RAW.slice(-9)}%'
           AND c.created_at > now() - interval '5 minutes'
         ORDER BY c.created_at DESC LIMIT 1;`
      );
      if (rows && rows[0]) {
        conv = rows[0];
        const turns = Array.isArray(conv.transcript) ? conv.transcript.length : 0;
        if (turns >= 2) break;
      }
    }

    if (!conv) {
      record('0.6', 'E2E chatbot', false, 'nessuna conversation creata entro 60s');
      return;
    }
    const turns = Array.isArray(conv.transcript) ? conv.transcript.length : 0;
    if (turns < 2) {
      record('0.6', 'E2E chatbot', false, `conversation ${conv.id} ha solo ${turns} turni`);
    } else {
      record('0.6', 'E2E chatbot', true, `conv ${conv.id.slice(0, 8)} ${turns} turni`);
    }

    // Cleanup conv + guest fittizio
    await runSql(`DELETE FROM audit_events WHERE entity_id = '${conv.id}';`);
    await runSql(`DELETE FROM conversations WHERE id = '${conv.id}';`);
    await runSql(
      `DELETE FROM guests WHERE tenant_id = '${TENANT_PICNIC}' AND phone LIKE '%${SMOKE_PHONE_RAW.slice(-9)}%';`
    );
    await runSql(
      `DELETE FROM bot_sessions WHERE phone LIKE '%${SMOKE_PHONE_RAW.slice(-9)}%';`
    );
  } catch (e) {
    record('0.6', 'E2E chatbot', false, e.message);
  }
}

// -------- 0.7: availability route (sola lettura) --------
async function test07() {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().slice(0, 10);
    const url = `${CRM_URL}/api/ai/availability?tenant_id=${TENANT_PICNIC}&date=${date}&party_size=2`;
    const r = await fetch(url, { headers: { 'x-ai-secret': AI_SECRET } });
    if (!r.ok) {
      const t = await r.text();
      record('0.7', 'availability route', false, `HTTP ${r.status} ${t.slice(0, 80)}`);
      return;
    }
    const j = await r.json();
    const slots = Array.isArray(j.availability) ? j.availability : [];
    if (slots.length === 0 && !j.closed) {
      record('0.7', 'availability route', false, `JSON ok ma availability vuota: ${JSON.stringify(j).slice(0, 100)}`);
    } else {
      record('0.7', 'availability route', true, slots.length ? `${slots.length} slots` : 'closed-day OK');
    }
  } catch (e) {
    record('0.7', 'availability route', false, e.message);
  }
}

// -------- main --------
(async () => {
  const t0 = Date.now();
  console.log(`SMOKE TEST RESULTS — ${new Date().toISOString()}`);
  await test01();
  await test02();
  await test03();
  await test04();
  await test05();
  await test06();
  await test07();
  const pass = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log('');
  console.log(`Overall: ${pass}/${total} ${pass === total ? 'PASS — safe to proceed' : 'FAIL — stop and debug'}`);
  console.log(`Duration: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(pass === total ? 0 : 1);
})();
