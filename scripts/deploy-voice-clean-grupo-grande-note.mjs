#!/usr/bin/env node
// Deploy: stop the VOICE agent from writing the Spanish internal annotation
// "Grupo grande, pendiente de revision" into a reservation's guest-facing notes.
// The "Book Logic" node sent  notes: notas + ' — Grupo grande, pendiente de
// revision'  on large-group bookings; status='escalated' already conveys that,
// and the zone reaches the API in its own `zone` field, so the note should just
// be the guest's own text. /api/ai/book already strips this defensively — this
// removes it at the source too.
//
// Safe: GET live -> backup -> verify anchor appears EXACTLY once (else ABORT)
// -> single targeted replace -> verify "Grupo grande" is gone -> PUT only
// {name,nodes,connections,settings,staticData}. Set DRY_RUN=1 to skip the PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = 'KLRgoVjOp9iZfr2R';
const NODE = 'Book Logic';

const ANCHOR = `notas ? notas + ' — Grupo grande, pendiente de revision' : 'Grupo grande - solicitud pendiente'`;
const REPLACEMENT = `notas || ''`;

const countOf = (s, sub) => s.split(sub).length - 1;

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

const stamp = process.env.STAMP || 'manual';
const backupPath = new URL(`../N8N/Voice_${ID}.LIVE_backup_pre_clean-grupo-grande_${stamp}.json`, import.meta.url);
writeFileSync(backupPath, JSON.stringify(wf, null, 2));
console.log('backup written:', backupPath.pathname);

const node = (wf.nodes || []).find((n) => n.name === NODE);
if (!node || typeof node.parameters?.jsCode !== 'string') {
  console.error('ABORT: target node or jsCode not found');
  process.exit(1);
}
let code = node.parameters.jsCode;

if (!code.includes('Grupo grande')) {
  console.error('ABORT: "Grupo grande" not present — already clean?');
  process.exit(1);
}
const n = countOf(code, ANCHOR);
if (n !== 1) {
  console.error(`ABORT: anchor found ${n} times (expected exactly 1)`);
  process.exit(1);
}

code = code.replace(ANCHOR, REPLACEMENT);

// Invariants: the phrase must be gone, the replacement present, length sane.
if (countOf(code, 'Grupo grande') !== 0) {
  console.error('ABORT: "Grupo grande" still present after replace');
  process.exit(1);
}
if (!code.includes(`notes: ${REPLACEMENT}`)) {
  console.error('ABORT: replacement not found in expected position');
  process.exit(1);
}
node.parameters.jsCode = code;

if (process.env.DRY_RUN) {
  console.log('DRY_RUN: replace verified, NOT writing. New notes line:');
  for (const line of code.split('\n')) if (line.includes('notes: notas')) console.log('  ', line.trim());
  process.exit(0);
}

await api('PUT', ID, {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
  staticData: wf.staticData ?? null,
});
console.log('PUT ok — voice workflow updated. "Grupo grande" note removed at source.');
