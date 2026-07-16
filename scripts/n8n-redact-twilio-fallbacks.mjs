#!/usr/bin/env node
// Tier 1.6 — redact Twilio fallback literali nei workflow n8n non-chatbot.
//
// Tutti i Code node usano già il pattern `picnicCfgGet(_bc, 'twilio_*', '<literal>')`
// (o il sinonimo `bc.twilio_* || '<literal>'`) — il valore vero arriva da
// `tenants.settings.bot_config`, ma il fallback ha sempre il literal Twilio
// hardcoded. Lo script sostituisce il fallback con '' (stringa vuota), così
// se in futuro bot_config si svuota il workflow fallisce in modo esplicito
// invece di silenziosamente usare credenziali staliche.
//
// Backup OBBLIGATORI già fatti in /Users/amplaye/picnic_backups/.
//
// Usage: N8N_API_KEY=... node scripts/n8n-redact-twilio-fallbacks.mjs <id> [...ids]

const N8N_BASE = 'https://n8n.srv1468837.hstgr.cloud';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

if (!N8N_API_KEY) {
  console.error('N8N_API_KEY env var required.');
  process.exit(2);
}

const IDS = process.argv.slice(2);
if (IDS.length === 0) {
  console.error('Usage: node n8n-redact-twilio-fallbacks.mjs <workflow-id> [more-ids]');
  process.exit(2);
}

// Patterns to redact. We match the fallback after the bot_config getter,
// so we only touch literal strings that appear as the third argument of
// picnicCfgGet or as the right-hand side of `||` after a bc.twilio_* read.
const REPLACEMENTS = [
  // Twilio SID
  [/(picnicCfgGet\(_bc,\s*'twilio_account_sid',\s*)'AC[0-9a-f]{32}'/g, "$1''"],
  [/(bc\.twilio_account_sid\s*\|\|\s*)'AC[0-9a-f]{32}'/g, "$1''"],
  // Twilio Auth Token
  [/(picnicCfgGet\(_bc,\s*'twilio_auth_token',\s*)'[0-9a-f]{32}'/g, "$1''"],
  [/(bc\.twilio_auth_token\s*\|\|\s*)'[0-9a-f]{32}'/g, "$1''"],
  // Twilio FROM number (whatsapp:+...). Pattern more permissive — fallback
  // is sometimes the sandbox number, sometimes the customer's; both go away.
  [/(picnicCfgGet\(_bc,\s*'twilio_from_number',\s*)'whatsapp:\+[0-9]+'/g, "$1''"],
  [/(bc\.twilio_from_number\s*\|\|\s*)'whatsapp:\+[0-9]+'/g, "$1''"],
];

function redact(code) {
  if (typeof code !== 'string') return { code, changed: 0 };
  let out = code;
  let changed = 0;
  for (const [re, sub] of REPLACEMENTS) {
    const before = out;
    out = out.replace(re, sub);
    if (out !== before) changed++;
  }
  return { code: out, changed };
}

async function fetchWorkflow(id) {
  const r = await fetch(`${N8N_BASE}/api/v1/workflows/${id}`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  if (!r.ok) throw new Error(`fetch ${id}: HTTP ${r.status}`);
  return r.json();
}

async function putWorkflow(id, body) {
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
  if (!r.ok) throw new Error(`PUT ${id}: HTTP ${r.status} — ${await r.text()}`);
  return r.json();
}

(async () => {
  for (const id of IDS) {
    console.log(`\n=== ${id} ===`);
    const wf = await fetchWorkflow(id);
    console.log(`  name: ${wf.name}`);
    let touched = 0;
    for (const n of wf.nodes || []) {
      const code = n.parameters && n.parameters.jsCode;
      if (typeof code !== 'string') continue;
      const { code: out, changed } = redact(code);
      if (changed) {
        n.parameters.jsCode = out;
        touched++;
        console.log(`  redacted ${changed} pattern(s) in node "${n.name}"`);
      }
    }
    if (touched === 0) {
      console.log('  → no patterns matched');
      continue;
    }
    if (process.env.DRY_RUN === '1') {
      console.log(`  DRY_RUN: would PUT ${touched} node(s)`);
      continue;
    }
    await putWorkflow(id, wf);
    console.log(`  PUT ok (${touched} node(s) touched)`);
  }
})();
