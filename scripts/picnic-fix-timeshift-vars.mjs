#!/usr/bin/env node
// Corrective patch: the deployed time-shift block referenced variables that do
// NOT exist in the node scope (API_BASE, AI_SECRET, TENANT_ID), making it a
// silent no-op. Rewrite those identifiers to the real in-scope names:
//   API_BASE   -> CRM_API_BASE_CFG
//   AI_SECRET  -> AI_SECRET_CFG
//   TENANT_ID  -> PICNIC_CFG_TENANT_ID
// Scoped strictly to the injected block (delimited by its marker comment).
// GET -> backup -> verify -> targeted replace -> PUT -> caller re-GETs.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = '166QnQsGHqXDpBxa';
const NODE = 'Fetch History + Check Availability';
const MARKER = '// [Picnic late-arrival time-shift]';

async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/v1/workflows/${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} — ${await r.text()}`);
  return r.json();
}

const wf = await api('GET', ID);
const stamp = process.env.STAMP || 'fixvars';
writeFileSync(new URL(`../N8N/picnic/Picnic_Chatbot_WhatsApp.LIVE_backup_fixvars_${stamp}.json`, import.meta.url), JSON.stringify(wf, null, 2));

const node = (wf.nodes || []).find((n) => n.name === NODE);
let code = node.parameters.jsCode;

// Isolate the injected block: from MARKER to the closing best-effort comment line.
const start = code.indexOf(MARKER);
if (start < 0) { console.error('ABORT: marker not found'); process.exit(1); }
const endNeedle = '/* best-effort; non bloccare la risposta */ }';
const endIdx = code.indexOf(endNeedle, start);
if (endIdx < 0) { console.error('ABORT: block end not found'); process.exit(1); }
const end = endIdx + endNeedle.length;
let block = code.slice(start, end);

if (block.includes('CRM_API_BASE_CFG')) { console.error('ABORT: block already fixed'); process.exit(1); }

// Word-boundary replacements, block-local only.
const before = block;
block = block
  .replace(/\bAPI_BASE\b/g, 'CRM_API_BASE_CFG')
  .replace(/\bAI_SECRET\b/g, 'AI_SECRET_CFG')
  .replace(/\bTENANT_ID\b/g, 'PICNIC_CFG_TENANT_ID');

const checks = {
  changed: block !== before,
  no_stale_API_BASE: !/\bAPI_BASE\b/.test(block),
  no_stale_AI_SECRET: !/\bAI_SECRET\b/.test(block),
  no_stale_TENANT_ID: !/\bTENANT_ID\b/.test(block),
  has_crm_base: block.includes('CRM_API_BASE_CFG'),
  has_secret_cfg: block.includes('AI_SECRET_CFG'),
  has_tenant_cfg: block.includes('PICNIC_CFG_TENANT_ID'),
  retraso_still_2: (block.split('retraso_minutos').length - 1) === 2,
  from_still_present: /\bfrom\b/.test(block),
};
console.log('block checks:', JSON.stringify(checks));
if (!Object.values(checks).every(Boolean)) { console.error('ABORT: block checks failed'); process.exit(1); }

const newCode = code.slice(0, start) + block + code.slice(end);
// whole-node invariants
const inv = {
  noshow_intact: newCode.includes('noshow_warning_responded'),
  anchor_intact: (newCode.split('const isArrivalCmd = !!_msgL && _arrivalRegex.test(_msgL);').length - 1) === 1,
  marker_once: (newCode.split(MARKER).length - 1) === 1,
};
console.log('node invariants:', JSON.stringify(inv));
if (!Object.values(inv).every(Boolean)) { console.error('ABORT: node invariants failed'); process.exit(1); }

node.parameters.jsCode = newCode;

if (process.env.DRY_RUN === '1') { console.log('DRY_RUN: skipping PUT'); process.exit(0); }

await api('PUT', ID, {
  name: wf.name, nodes: wf.nodes, connections: wf.connections,
  settings: wf.settings || {}, staticData: wf.staticData || null,
});
console.log('PUT ok');
