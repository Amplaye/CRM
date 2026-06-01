#!/usr/bin/env node
// Deploy the "requested-shift-missing" fix into the live OpenAI node of the
// restaurant chatbot workflows. Bug: when a client asks for a LUNCH time on a
// day that only opens for dinner (e.g. Tuesday 19:30 only), the before-open
// branch said "el servicio empieza a las 19:30" — which the LLM rendered as the
// nonsensical "lunch service starts at 19:30". The fix detects that the
// requested shift (lunch/dinner) does not exist that day and instructs the model
// to say so explicitly and offer the real shift or another day.
//
// Safe: GET live -> verify anchor appears EXACTLY once and fix not already
// present -> targeted replace -> invariants -> backup -> PUT -> re-GET verify.
// Usage: node scripts/deploy-missing-shift-fix.mjs <oraz|picnic|all> [DRY_RUN=1]
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const cfg = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = cfg('N8N_BASE_URL');
const KEY = cfg('N8N_API_KEY');
const NODE = 'OpenAI';

const TENANTS = {
  oraz:   { id: 'wXDEbfQ6FCO3ywnt', label: 'Oraz' },
  picnic: { id: '166QnQsGHqXDpBxa', label: 'Picnic' },
};

const ANCHOR = `          if (_isBeforeOpen) {
            const _firstOpenStr = _hmStr(_firstOpenMin);
            _sess.proposedHora = _firstOpenStr;
            nextInstruction = \`El cliente ha pedido la hora \${f.hora}, que es ANTES de la apertura. El servicio empieza a las \${_firstOpenStr}. Dile EN SU IDIOMA, en una sola frase corta: que el servicio empieza a las \${_firstOpenStr} y pregúntale si quiere reservar a esa hora o cambiar día/horario. NO propongas otra hora distinta. NO uses tools.\`;
            f.hora = null;
          } else {`;

const REPLACE = `          if (_isBeforeOpen) {
            const _firstOpenStr = _hmStr(_firstOpenMin);
            _sess.proposedHora = _firstOpenStr;
            // FIX 2026-06-01 (requested-shift-missing): if the client asked for a
            // LUNCH time (<17:00) but the day has NO lunch shift at all (only
            // dinner), do NOT say "service starts at 19:30" — that reads as
            // "lunch starts at 19:30". Say explicitly the day has no lunch and
            // offer dinner or another day. Mirror for a dinner request on a
            // lunch-only day. Shift split at 17:00 (same as waitlist turno).
            const _SHIFT_SPLIT = 17 * 60;
            const _askedIsLunch = askedMin < _SHIFT_SPLIT;
            const _dayHasLunch = ranges.some(r => r.open < _SHIFT_SPLIT);
            const _dayHasDinner = ranges.some(r => r.open >= _SHIFT_SPLIT);
            const _nextIsDinner = _firstOpenMin >= _SHIFT_SPLIT;
            const _shiftMissing = (_askedIsLunch && _nextIsDinner && !_dayHasLunch) || (!_askedIsLunch && !_nextIsDinner && !_dayHasDinner);
            if (_shiftMissing) {
              const _wantES = _askedIsLunch ? 'almuerzo' : 'cena';
              const _haveES = _askedIsLunch ? 'cena' : 'almuerzo';
              nextInstruction = \`Ese día NO ofrecemos \${_wantES}: solo abrimos para \${_haveES} desde las \${_firstOpenStr}. Dile al cliente EN SU IDIOMA, en una sola frase corta: que ese día no hacemos \${_wantES}, solo \${_haveES} desde las \${_firstOpenStr}, y pregúntale si prefiere reservar para \${_haveES} a esa hora o elegir otro día para \${_wantES}. NO inventes otra hora. NO uses tools.\`;
            } else {
              nextInstruction = \`El cliente ha pedido la hora \${f.hora}, que es ANTES de la apertura. El servicio empieza a las \${_firstOpenStr}. Dile EN SU IDIOMA, en una sola frase corta: que el servicio empieza a las \${_firstOpenStr} y pregúntale si quiere reservar a esa hora o cambiar día/horario. NO propongas otra hora distinta. NO uses tools.\`;
            }
            f.hora = null;
          } else {`;

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
    console.error('  ABORT: OpenAI node or jsCode not found');
    return false;
  }
  let code = node.parameters.jsCode;
  const before = code.length;

  if (code.includes('requested-shift-missing')) {
    console.log('  SKIP: fix already present (idempotent)');
    return true;
  }
  const ac = countOf(code, ANCHOR);
  console.log(`  anchor (_isBeforeOpen block): ${ac}`);
  if (ac !== 1) {
    console.error('  ABORT: anchor not found exactly once — live code drifted, manual review needed');
    return false;
  }

  code = code.replace(ANCHOR, REPLACE);

  const checks = {
    marker_once:     countOf(code, 'requested-shift-missing') === 1,
    shiftmissing_var: code.includes('const _shiftMissing ='),
    fallback_kept:   code.includes('que es ANTES de la apertura'), // original message still present in else
    split_present:   code.includes('const _SHIFT_SPLIT = 17 * 60;'),
  };
  console.log('  pre-PUT checks:', JSON.stringify(checks));
  if (!Object.values(checks).every(Boolean)) {
    console.error('  ABORT: post-replace invariants failed');
    return false;
  }
  if (!isParseable(code)) return false;

  const backupPath = new URL(`../N8N/_menu_work/LIVE_backup_${key}_pre-missingshift-fix.json`, import.meta.url);
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
  const ok = codeAfter.includes('requested-shift-missing');
  console.log(ok ? '  ✅ PUT verified live' : '  ❌ PUT verification FAILED');
  return ok;
}

const which = process.argv[2] || 'all';
const keys = which === 'all' ? Object.keys(TENANTS) : [which];
let allOk = true;
for (const k of keys) {
  if (!TENANTS[k]) { console.error('unknown tenant:', k); allOk = false; continue; }
  const ok = await deployOne(k);
  allOk = allOk && ok;
}
console.log(allOk ? '\n✅ DONE' : '\n❌ FINISHED WITH ERRORS');
process.exit(allOk ? 0 : 1);
