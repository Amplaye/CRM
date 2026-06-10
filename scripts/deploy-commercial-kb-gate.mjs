#!/usr/bin/env node
// Deploy A — Commercial-info module, engine plumbing (fetch node "Fetch History +
// Check Availability"):
//   1) capture tenant `features` in the cached tenant config
//   2) gate `commerciale` KB articles by the per-tenant commercial_info_enabled flag
//      (OFF → stripped before they ever reach the prompt) and collect the published
//      commerciale TITLES into COMMERCIAL_OFFERS for the proactive button offer
//   3) pass commercialOn / commercialOffers downstream to the OpenAI node
// Generic + flag-gated: only a tenant with the flag ON (today: Oraz) is affected.
//
// Safe pattern: GET live -> backup -> verify each anchor appears EXACTLY once
// (else ABORT) -> targeted replaces -> invariants -> node --check the patched node
// -> PUT only {name,nodes,connections,settings,staticData}. DRY_RUN=1 skips the PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = '166QnQsGHqXDpBxa';
const NODE = 'Fetch History + Check Availability';

const countOf = (s, sub) => s.split(sub).length - 1;

// --- Anchor 1: cache success object — add `features` ---
const A1 = `    _picnicTenantCfgCache = {
      bot_config: Object.assign({}, s.bot_config || {}, ((data && data[0] && data[0].secrets) || {})),
      opening_hours: s.opening_hours || {},
      zone_count: 1
    };`;
const A1_NEW = `    _picnicTenantCfgCache = {
      bot_config: Object.assign({}, s.bot_config || {}, ((data && data[0] && data[0].secrets) || {})),
      opening_hours: s.opening_hours || {},
      features: s.features || {},
      zone_count: 1
    };`;

// --- Anchor 1b: cache fallback — add `features` ---
const A1b = `    _picnicTenantCfgCache = { bot_config: {}, opening_hours: {}, zone_count: 1 };`;
const A1b_NEW = `    _picnicTenantCfgCache = { bot_config: {}, opening_hours: {}, features: {}, zone_count: 1 };`;

// --- Anchor 2: KB build — gate `commerciale` by the flag + collect offers ---
const A2 = `let kbContext = '';
var kbContent = '';
try {
  if (kbResW.ok) {
    const kbData = typeof kbResW.r === 'string' ? JSON.parse(kbResW.r) : kbResW.r;
    if (kbData && kbData.length > 0) {
      kbContext = '\\n\\nINFORMACIÓN ACTUALIZADA DEL RESTAURANTE (Knowledge Base):\\n' + kbData.map(a => '- ' + a.title + ': ' + _kbSection(a.content, lang)).join('\\n');
      kbContent = kbData.map(a => '[' + a.category + '] ' + a.title + ': ' + _kbSection(a.content, lang)).join('\\n\\n');
    }
  }
} catch(e) {}`;
const A2_NEW = `let kbContext = '';
var kbContent = '';
// [commercial-info] Commercial KB articles (category 'commerciale': price lists,
// set menus, buffets, cakes) reach the bot ONLY when the tenant's
// commercial_info_enabled feature flag is ON. When OFF they're stripped here so the
// bot stays silent on commercial topics. COMMERCIAL_OFFERS = the published
// commerciale titles, fed downstream as tappable proactive-offer button labels.
// Per-tenant + generic: another tenant flips the flag + writes its own articles ->
// its own answers and buttons, zero code change.
var COMMERCIAL_ON = false;
try { COMMERCIAL_ON = ((_picnicTenantCfg && _picnicTenantCfg.features && _picnicTenantCfg.features.commercial_info_enabled) === true); } catch(_ec) {}
var COMMERCIAL_OFFERS = [];
try {
  if (kbResW.ok) {
    var kbData = typeof kbResW.r === 'string' ? JSON.parse(kbResW.r) : kbResW.r;
    if (Array.isArray(kbData) && kbData.length > 0) {
      if (COMMERCIAL_ON) {
        COMMERCIAL_OFFERS = kbData.filter(function(a){ return a && a.category === 'commerciale'; }).map(function(a){ return a.title; });
      } else {
        kbData = kbData.filter(function(a){ return !a || a.category !== 'commerciale'; });
      }
      kbContext = '\\n\\nINFORMACIÓN ACTUALIZADA DEL RESTAURANTE (Knowledge Base):\\n' + kbData.map(a => '- ' + a.title + ': ' + _kbSection(a.content, lang)).join('\\n');
      kbContent = kbData.map(a => '[' + a.category + '] ' + a.title + ': ' + _kbSection(a.content, lang)).join('\\n\\n');
    }
  }
} catch(e) {}`;

// --- Anchor 3: output json — pass commercialOn / commercialOffers downstream ---
const A3 = `conversation_id: _picnicConvIdOut, skip: false }`;
const A3_NEW = `conversation_id: _picnicConvIdOut, commercialOn: COMMERCIAL_ON, commercialOffers: COMMERCIAL_OFFERS, skip: false }`;

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
writeFileSync(new URL(`../N8N/picnic/Chatbot_166.LIVE_backup_pre_commercial-kb-gate_${stamp}.json`, import.meta.url), JSON.stringify(wf, null, 2));

const node = (wf.nodes || []).find((n) => n.name === NODE);
if (!node || typeof node.parameters?.jsCode !== 'string') { console.error('ABORT: node/jsCode not found'); process.exit(1); }
let code = node.parameters.jsCode;

if (code.includes('[commercial-info]')) { console.error('ABORT: commercial-info block already present'); process.exit(1); }
for (const [label, anchor] of [['A1', A1], ['A1b', A1b], ['A2', A2], ['A3', A3]]) {
  const c = countOf(code, anchor);
  if (c !== 1) { console.error(`ABORT: anchor ${label} count is ${c}, expected exactly 1`); process.exit(1); }
}

code = code.replace(A1, A1_NEW).replace(A1b, A1b_NEW).replace(A2, A2_NEW).replace(A3, A3_NEW);

const checks = {
  marker_1: countOf(code, '[commercial-info]') === 1,
  features_success: countOf(code, 'features: s.features || {}') === 1,
  features_fallback: countOf(code, 'features: {}, zone_count: 1') === 1,
  commercial_on_def: countOf(code, 'var COMMERCIAL_ON = false;') === 1,
  offers_def: countOf(code, 'var COMMERCIAL_OFFERS = []') === 1,
  output_wired: countOf(code, 'commercialOn: COMMERCIAL_ON, commercialOffers: COMMERCIAL_OFFERS') === 1,
  kb_still_built: countOf(code, "kbContent = kbData.map(a => '[' + a.category + '] '") === 1,
};
console.log('pre-PUT checks:', JSON.stringify(checks));
if (!Object.values(checks).every(Boolean)) { console.error('ABORT: invariants failed'); process.exit(1); }

node.parameters.jsCode = code;
writeFileSync(new URL('../N8N/picnic/_patched_Fetch_commercial_kb_gate.js', import.meta.url), code);

if (process.env.DRY_RUN === '1') { console.log('DRY_RUN: skipping PUT (patched node written for node --check)'); process.exit(0); }

await api('PUT', ID, { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {}, staticData: wf.staticData || null });
console.log('PUT ok');
