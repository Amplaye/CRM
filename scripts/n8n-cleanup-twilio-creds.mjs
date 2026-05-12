#!/usr/bin/env node
// Tier 1.6 — Sostituisce nei workflow n8n NON-chatbot le costanti
// `TWILIO_SID`/`TWILIO_TOKEN`/`TWILIO_FROM` literali con un loader che
// legge `tenants.settings.bot_config.{twilio_account_sid,
// twilio_auth_token, twilio_from_number}` (lo stesso pattern del chatbot
// post-Risk #2). La Supabase service-role JWT resta hardcoded come unico
// secret nel nodo (PICNIC_CFG_SB_KEY) — net reduction di 3 literali a 1.
//
// Workflow target: tutti i `[Picnic] *` tranne il chatbot.
// Backup OBBLIGATORI già fatti in /Users/amplaye/picnic_backups/.
//
// Usage:  N8N_API_KEY=... SB_SERVICE_KEY=... node scripts/n8n-cleanup-twilio-creds.mjs

const N8N_BASE = 'https://n8n.srv1468837.hstgr.cloud';
const N8N_API_KEY = process.env.N8N_API_KEY || '';
const SB_KEY = process.env.SB_SERVICE_KEY || '';
const SB_URL = 'https://azhlnybiqlkbhbboyvud.supabase.co';
const TENANT_ID = '626547ff-bc44-4f35-8f42-0e97f1dcf0d5';

if (!N8N_API_KEY || !SB_KEY) {
  console.error('N8N_API_KEY and SB_SERVICE_KEY env vars required.');
  process.exit(2);
}

const WORKFLOW_IDS = process.argv.slice(2);
if (WORKFLOW_IDS.length === 0) {
  console.error('Usage: node scripts/n8n-cleanup-twilio-creds.mjs <id1> <id2> ...');
  process.exit(2);
}

const BOOTSTRAP_HEADER = `
// === PICNIC TENANT CONFIG LOADER v1.6 — auto-injected to drop Twilio literals ===
const PICNIC_CFG_TENANT_ID = '${TENANT_ID}';
const PICNIC_CFG_SB_URL = '${SB_URL}';
const PICNIC_CFG_SB_KEY = '${SB_KEY}';
let _picnicCfgCache = null;
async function picnicLoadCfg(_ctx) {
  if (_picnicCfgCache) return _picnicCfgCache;
  try {
    const res = await _ctx.helpers.httpRequest({
      method: 'GET',
      url: PICNIC_CFG_SB_URL + '/rest/v1/tenants?id=eq.' + PICNIC_CFG_TENANT_ID + '&select=settings',
      headers: { apikey: PICNIC_CFG_SB_KEY, Authorization: 'Bearer ' + PICNIC_CFG_SB_KEY }
    });
    const data = typeof res === 'string' ? JSON.parse(res) : res;
    _picnicCfgCache = (data && data[0] && data[0].settings && data[0].settings.bot_config) || {};
  } catch(e) { _picnicCfgCache = {}; }
  return _picnicCfgCache;
}
// === END LOADER ===
`;

// Patterns to replace. Each is a regex that matches the literal assignment
// and a function that produces the replacement (using picnicLoadCfg).
const SID_RE = /const\s+TWILIO_SID\s*=\s*'AC[0-9a-f]{32}';?/g;
const TOKEN_RE = /const\s+TWILIO_TOKEN\s*=\s*'[0-9a-f]{32}';?/g;
const FROM_RE = /const\s+TWILIO_FROM\s*=\s*'whatsapp:\+[0-9]+';?/g;

const REPLACEMENT_BLOCK = `const _picBC = await picnicLoadCfg(this);
const TWILIO_SID = _picBC.twilio_account_sid || '';
const TWILIO_TOKEN = _picBC.twilio_auth_token || '';
const TWILIO_FROM = _picBC.twilio_from_number || 'whatsapp:+14155238886';`;

function patchJsCode(jsCode) {
  if (typeof jsCode !== 'string') return { changed: false, code: jsCode };
  const hasSid = SID_RE.test(jsCode);
  SID_RE.lastIndex = 0;
  if (!hasSid) return { changed: false, code: jsCode };

  // Drop TOKEN and FROM literals (they always sit adjacent to SID), insert
  // unified replacement at the SID location, and prepend the loader if
  // not already present.
  let out = jsCode;
  out = out.replace(SID_RE, REPLACEMENT_BLOCK);
  out = out.replace(TOKEN_RE, '');
  out = out.replace(FROM_RE, '');

  if (!out.includes('picnicLoadCfg(this)') || !out.includes('=== PICNIC TENANT CONFIG LOADER v1.6')) {
    // make sure the loader is at the top once
  }
  if (!out.includes('async function picnicLoadCfg')) {
    out = BOOTSTRAP_HEADER + '\n' + out;
  }
  return { changed: true, code: out };
}

async function fetchWorkflow(id) {
  const r = await fetch(`${N8N_BASE}/api/v1/workflows/${id}`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  if (!r.ok) throw new Error(`fetch ${id}: HTTP ${r.status}`);
  return r.json();
}

async function putWorkflow(id, body) {
  // n8n PUT only accepts a known set of fields. Strip readonly metadata.
  const clean = {
    name: body.name,
    nodes: body.nodes,
    connections: body.connections,
    settings: body.settings || {},
    staticData: body.staticData || null,
  };
  const r = await fetch(`${N8N_BASE}/api/v1/workflows/${id}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(clean),
  });
  if (!r.ok) throw new Error(`PUT ${id}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  for (const id of WORKFLOW_IDS) {
    console.log(`\n=== Workflow ${id} ===`);
    const wf = await fetchWorkflow(id);
    console.log(`  name: ${wf.name}, nodes: ${wf.nodes.length}`);
    let patchedNodes = 0;
    for (const n of wf.nodes) {
      const code = (n.parameters && n.parameters.jsCode);
      if (typeof code !== 'string') continue;
      const { changed, code: out } = patchJsCode(code);
      if (changed) {
        n.parameters.jsCode = out;
        patchedNodes++;
        console.log(`  patched node "${n.name}"`);
      }
    }
    if (patchedNodes === 0) {
      console.log('  → no nodes matched, skipping PUT');
      continue;
    }
    if (process.env.DRY_RUN === '1') {
      console.log(`  DRY_RUN: would PUT ${patchedNodes} patched nodes`);
      continue;
    }
    await putWorkflow(id, wf);
    console.log(`  PUT ok (${patchedNodes} node(s) updated)`);
  }
})();
