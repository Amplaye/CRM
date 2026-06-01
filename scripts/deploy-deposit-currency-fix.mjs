#!/usr/bin/env node
// Deploy the "deposit shows currency" fix into the live `Book + Notify Owner`
// node of the restaurant chatbot workflow(s). Bug: when the owner enters a bare
// number for the deposit (e.g. "70"), the WhatsApp booking recap renders it
// verbatim as "(70)" — no currency. The bot now formats a bare amount at display
// time, so "70" → "70 €" regardless of how the value was stored. The CRM already
// formats on write (formatDepositAmount in kb-generator.ts); this closes the gap
// on the bot's recap card and — applied to the PICNIC template — every future
// clone inherits it.
//
// Safe: GET live -> SKIP if already present -> verify anchor appears EXACTLY once
// -> targeted replace -> invariants -> backup -> PUT -> re-GET verify. Parse-only
// validation via node:vm (no eval, no child_process).
// Usage: node scripts/deploy-deposit-currency-fix.mjs <picnic|oraz|all> [DRY_RUN=1]
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const cfg = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = cfg('N8N_BASE_URL');
const KEY = cfg('N8N_API_KEY');
const NODE = 'Book + Notify Owner';
const MARKER = 'deposit-currency-fix';

const TENANTS = {
  picnic: { id: '166QnQsGHqXDpBxa', label: 'Picnic' },
  oraz:   { id: 'wXDEbfQ6FCO3ywnt', label: 'Oraz' },
};

// Exact live block (2-space indent), recap deposit line inside _buildVenueRecap.
const ANCHOR = `  if (isLarge && venue.deposit_required) {
    const amt = (venue.deposit_amount || '').trim();
    lines.push(L.deposit + ' ' + L.depositYes + (amt ? ' (' + amt + ')' : ''));
  }`;

const REPLACE = `  if (isLarge && venue.deposit_required) {
    // FIX 2026-06-01 (deposit-currency-fix): format a BARE number ("70") with the
    // currency symbol ("70 €") at display time. Belt-and-suspenders — correct no
    // matter how deposit_amount was stored. Anything already containing a non-digit
    // (e.g. "20€ a persona", "50 € por mesa") is passed through untouched.
    const _amtRaw = (venue.deposit_amount || '').trim();
    const _amt = /^\\d{1,3}([.,]\\d{3})*([.,]\\d{1,2})?$|^\\d+([.,]\\d{1,2})?$/.test(_amtRaw) ? (_amtRaw + ' €') : _amtRaw;
    lines.push(L.deposit + ' ' + L.depositYes + (_amt ? ' (' + _amt + ')' : ''));
  }`;

const countOf = (s, sub) => s.split(sub).length - 1;

async function api(method, id, body) {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${id}: HTTP ${r.status} — ${await r.text()}`);
  return r.json();
}

function isParseable(code) {
  try { new vm.Script('(async function(){\n' + code + '\n})', { filename: 'patched.js' }); return true; }
  catch (e) { console.error('  ABORT: syntax error after patch —', e.message); return false; }
}

async function deployOne(key) {
  const t = TENANTS[key];
  console.log(`\n=== ${t.label} (${t.id}) ===`);
  const wf = await api('GET', t.id);
  const node = (wf.nodes || []).find((n) => n.name === NODE);
  if (!node || typeof node.parameters?.jsCode !== 'string') {
    console.error(`  ABORT: "${NODE}" node or jsCode not found`);
    return false;
  }
  let code = node.parameters.jsCode;
  const before = code.length;

  if (code.includes(MARKER)) {
    console.log('  SKIP: fix already present (idempotent)');
    return true;
  }
  const ac = countOf(code, ANCHOR);
  console.log(`  anchor (deposit recap block): ${ac}`);
  if (ac !== 1) {
    console.error('  ABORT: anchor not found exactly once — live code drifted, manual review needed');
    return false;
  }

  code = code.replace(ANCHOR, REPLACE);

  const checks = {
    marker_once:   countOf(code, MARKER) === 1,
    formatter_var: code.includes('const _amt ='),
    regex_present: code.includes("([.,]\\d{3})*"),
    anchor_gone:   countOf(code, ANCHOR) === 0,
  };
  console.log('  pre-PUT checks:', JSON.stringify(checks));
  if (!Object.values(checks).every(Boolean)) {
    console.error('  ABORT: post-replace invariants failed');
    return false;
  }
  if (!isParseable(code)) return false;

  const backupPath = new URL(`../N8N/_menu_work/LIVE_backup_${key}_pre-deposit-currency-fix.json`, import.meta.url);
  writeFileSync(backupPath, JSON.stringify(wf, null, 2));
  console.log('  backup:', backupPath.pathname.split('/').slice(-2).join('/'), `(jsCode ${before} → ${code.length})`);

  if (process.env.DRY_RUN === '1') {
    console.log('  DRY_RUN: skipping PUT');
    return true;
  }

  node.parameters.jsCode = code;
  await api('PUT', t.id, {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings || {},
    staticData: wf.staticData || null,
  });

  const after = await api('GET', t.id);
  const codeAfter = (after.nodes || []).find((n) => n.name === NODE)?.parameters?.jsCode || '';
  const ok = codeAfter.includes(MARKER);
  console.log(ok ? '  ✅ PUT verified live' : '  ❌ PUT verification FAILED');
  return ok;
}

const which = process.argv[2] || 'picnic';
const keys = which === 'all' ? Object.keys(TENANTS) : [which];
let allOk = true;
for (const k of keys) {
  if (!TENANTS[k]) { console.error('unknown tenant:', k); allOk = false; continue; }
  const ok = await deployOne(k);
  allOk = allOk && ok;
}
console.log(allOk ? '\n✅ DONE' : '\n❌ FINISHED WITH ERRORS');
process.exit(allOk ? 0 : 1);
