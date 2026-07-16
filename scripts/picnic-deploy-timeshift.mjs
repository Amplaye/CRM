#!/usr/bin/env node
// Deploy the late-arrival time-shift block into the live Picnic chatbot workflow.
// Safe: GET live -> backup -> verify anchor appears EXACTLY once (else ABORT)
// -> single targeted replace -> PUT only {name,nodes,connections,settings,staticData}
// -> re-GET and verify. Set DRY_RUN=1 to skip the PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = '166QnQsGHqXDpBxa';
const NODE = 'Fetch History + Check Availability';
const ANCHOR = 'const isArrivalCmd = !!_msgL && _arrivalRegex.test(_msgL);';

const BLOCK = `

// [Picnic late-arrival time-shift] Se il messaggio di ritardo indica un ritardo
// RELATIVO (es. "30 min", "media hora"), sposta l'ora della prenotazione via
// /api/ai/modify (retraso_minutos). Il backend ricalcola (21:30 + 30 -> 22:00).
if (isArrivalCmd) {
  try {
    let _rt = 0;
    const _mm2 = _msgL.match(/(\\d{1,3})\\s*(?:min|minut)/);
    if (/media\\s+hora|mezz'?\\s?ora|half\\s+an?\\s+hour/.test(_msgL)) _rt = 30;
    else if (/(?:una?|un'?)\\s?(?:hora|ora)\\b|\\ban?\\s+hour\\b/.test(_msgL)) _rt = 60;
    else if (_mm2) _rt = parseInt(_mm2[1], 10);
    if (_rt > 0 && _rt <= 240) {
      await this.helpers.httpRequest({
        method: 'PUT',
        url: API_BASE + '/api/ai/modify',
        headers: { 'Content-Type': 'application/json', 'x-ai-secret': AI_SECRET },
        body: { tenant_id: TENANT_ID, guest_phone: from, retraso_minutos: _rt },
        json: true
      });
    }
  } catch (_e) { /* best-effort; non bloccare la risposta */ }
}`;

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

// Backup
const stamp = process.env.STAMP || 'manual';
const backupPath = new URL(`../N8N/picnic/Picnic_Chatbot_WhatsApp.LIVE_backup_predeploy_${stamp}.json`, import.meta.url);
writeFileSync(backupPath, JSON.stringify(wf, null, 2));
console.log('backup written:', backupPath.pathname);

const node = (wf.nodes || []).find((n) => n.name === NODE);
if (!node || typeof node.parameters?.jsCode !== 'string') {
  console.error('ABORT: target node or jsCode not found');
  process.exit(1);
}
let code = node.parameters.jsCode;

if (code.includes('[Picnic late-arrival time-shift]')) {
  console.error('ABORT: time-shift block already present');
  process.exit(1);
}
const ac = countOf(code, ANCHOR);
if (ac !== 1) {
  console.error(`ABORT: anchor count is ${ac}, expected exactly 1`);
  process.exit(1);
}

code = code.replace(ANCHOR, ANCHOR + BLOCK);

// Post-replace invariants
const checks = {
  anchor_still_1: countOf(code, ANCHOR) === 1,
  marker_now_1: countOf(code, '[Picnic late-arrival time-shift]') === 1,
  retraso_now_2: countOf(code, 'retraso_minutos') === 2, // 1 in comment + 1 in body
  noshow_intact: code.includes('noshow_warning_responded'),
};
console.log('pre-PUT checks:', JSON.stringify(checks));
if (!Object.values(checks).every(Boolean)) {
  console.error('ABORT: post-replace invariants failed');
  process.exit(1);
}
node.parameters.jsCode = code;

if (process.env.DRY_RUN === '1') {
  console.log('DRY_RUN: skipping PUT');
  process.exit(0);
}

await api('PUT', ID, {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
  staticData: wf.staticData || null,
});
console.log('PUT ok');
