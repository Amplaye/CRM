#!/usr/bin/env node
// Fix: the voice summary's address/parking were always empty because the venue
// recap read picnicCfgGet(_bc,'venue') — but `venue` lives at settings.venue,
// not inside settings.bot_config (_bc). The chat loads it via the full tenant
// config. Mirror that: (A) make picnicLoadTenantConfig also return s.venue, and
// (B) read the venue from the loaded _picnicVoiceCfg instead of _bc.
//
// Safe: GET -> backup -> verify both anchors once -> 2 replaces -> PUT. DRY_RUN=1 skips PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = 'KLRgoVjOp9iZfr2R';
const NODE = 'Book Logic';
const countOf = (s, sub) => s.split(sub).length - 1;

const A_FROM = `    _picnicTenantCfgCache = { bot_config: s.bot_config || {}, opening_hours: s.opening_hours || {} };`;
const A_TO = `    _picnicTenantCfgCache = { bot_config: s.bot_config || {}, opening_hours: s.opening_hours || {}, venue: s.venue || {} };`;
const B_FROM = `      const _vcfg = picnicCfgGet(_bc, 'venue', {}) || {};`;
const B_TO = `      const _vcfg = (_picnicVoiceCfg && _picnicVoiceCfg.venue) || {};`;

async function n8n(method, path, body) {
  const r = await fetch(`${BASE}/api/v1/workflows/${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} — ${await r.text()}`);
  return r.json();
}

const wf = await n8n('GET', ID);
writeFileSync(new URL(`../N8N/Voice_${ID}.LIVE_backup_pre_venue-load-fix_${process.env.STAMP || 'manual'}.json`, import.meta.url), JSON.stringify(wf, null, 2));
const node = (wf.nodes || []).find((n) => n.name === NODE);
let code = node?.parameters?.jsCode;
if (typeof code !== 'string') { console.error('ABORT: node/jsCode not found'); process.exit(1); }
for (const [label, from] of [['A', A_FROM], ['B', B_FROM]]) {
  if (countOf(code, from) !== 1) { console.error(`ABORT: anchor ${label} count ${countOf(code, from)}`); process.exit(1); }
}
code = code.replace(A_FROM, A_TO).replace(B_FROM, B_TO);
if (!code.includes('venue: s.venue || {}') || !code.includes('_picnicVoiceCfg && _picnicVoiceCfg.venue')) {
  console.error('ABORT: post-edit verify failed'); process.exit(1);
}
node.parameters.jsCode = code;
if (process.env.DRY_RUN) { console.log('DRY_RUN: both edits verified.'); process.exit(0); }
await n8n('PUT', ID, { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {}, staticData: wf.staticData ?? null });
console.log('PUT ok — voice now loads venue from settings.venue (address/parking will populate).');
