#!/usr/bin/env node
// Deploy the "closed-day propose real hour" fix into the live OpenAI node of a
// restaurant chatbot workflow. The bug: on a closed day the controller proposes
// the next open day but copies the client's requested hour blindly — so "Monday
// closed, client asks 12:00" became "Tuesday at 12:00" even though Tuesday only
// opens for dinner at 19:30. The fix validates the proposed hour against that
// day's real opening ranges and, if it doesn't fit, proposes the first real
// opening time of the day.
//
// Safe: GET live -> verify anchors appear EXACTLY once and fix not already
// present -> two targeted replaces -> post-replace invariants -> backup ->
// PUT only {name,nodes,connections,settings,staticData} -> re-GET verify.
// Usage: node scripts/deploy-closedday-hour-fix.mjs <oraz|picnic|all> [DRY_RUN=1]
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

// --- The two exact anchor/replacement pairs (must match the live code byte-for-byte) ---
const A1 = `  function calLineFor(fecha) {
    return (calendarBlock || '').split('\\n').find(l => l.startsWith('- ' + fecha));
  }
  function isPast(fecha) { return fecha < todayStr; }`;
const R1 = `  function calLineFor(fecha) {
    return (calendarBlock || '').split('\\n').find(l => l.startsWith('- ' + fecha));
  }
  // FIX 2026-06-01 (closed-day-propose-real-hour): parse the open ranges of a
  // given day from the calendar line so we NEVER propose a time the venue is not
  // actually open. Returns [] for closed/unknown days.
  function _openRangesFor(fecha) {
    const _l = calLineFor(fecha);
    if (!_l || _l.includes('CERRADO')) return [];
    const hoursPart = _l.split(': ').slice(1).join(': ').trim().replace(/\\s*\\(última reserva [^)]+\\)/g, '');
    return hoursPart.split(' y ').map(function(r){
      const p = r.split('-'); if (p.length !== 2) return null;
      const a = p[0].split(':').map(Number), b = p[1].split(':').map(Number);
      return { open: a[0]*60+a[1], close: b[0]*60+b[1], openStr: p[0].trim(), closeStr: p[1].trim() };
    }).filter(Boolean);
  }
  // Returns an hour string that is REALLY bookable on \`fecha\`. If the wanted hour
  // fits an open shift (within last-reservation cap) it is kept; otherwise the
  // first open time of the day is returned. null only if the day has no ranges.
  function _proposeHoraFor(fecha, wantHora) {
    const ranges = _openRangesFor(fecha);
    if (!ranges.length) return null;
    if (wantHora) {
      const wp = String(wantHora).split(':').map(Number);
      const wmin = wp[0]*60 + (wp[1]||0);
      const fits = ranges.some(function(r){ return wmin >= r.open && wmin <= r.close - CLOSING_OFFSET_CFG; });
      if (fits) return wantHora;
    }
    return ranges[0].openStr;
  }
  function isPast(fecha) { return fecha < todayStr; }`;

const A2 = `        if (_b19aNext) {
          _sess.proposedDate = _b19aNext;
          if (f.hora) _sess.proposedHora = f.hora;
          const _b19aDow = new Date(_b19aNext + 'T12:00:00').getDay();
          nextInstruction = \`Los \${_dayNamesSM[_dow]} estamos cerrados. Propón al cliente cambiar al \${_dayNamesSM[_b19aDow]} \${_b19aNext}\` + (f.hora ? \` a las \${f.hora}\` : '') + \` y pregunta si le viene bien (responde sí/no).\`;
        } else {`;
const R2 = `        if (_b19aNext) {
          _sess.proposedDate = _b19aNext;
          // FIX 2026-06-01 (closed-day-propose-real-hour): do NOT copy the client's
          // requested hour blindly onto the next open day — it may be a lunch hour
          // on a dinner-only day (e.g. closed Monday → propose Tuesday, but Tuesday
          // only opens 19:30). Validate against that day's real ranges; if it does
          // not fit, propose that day's first real opening time instead.
          const _b19aHora = _proposeHoraFor(_b19aNext, f.hora);
          if (_b19aHora) _sess.proposedHora = _b19aHora; else delete _sess.proposedHora;
          const _b19aDow = new Date(_b19aNext + 'T12:00:00').getDay();
          nextInstruction = \`Los \${_dayNamesSM[_dow]} estamos cerrados. Propón al cliente cambiar al \${_dayNamesSM[_b19aDow]} \${_b19aNext}\` + (_b19aHora ? \` a las \${_b19aHora}\` : '') + \` y pregunta si le viene bien (responde sí/no). Propón SOLO esa hora; NO inventes ni cambies a otra hora.\`;
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

// Parse-only syntax validation (does NOT execute the code) using node:vm.
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

  if (code.includes('closed-day-propose-real-hour')) {
    console.log('  SKIP: fix already present (idempotent)');
    return true;
  }
  const a1 = countOf(code, A1), a2 = countOf(code, A2);
  console.log(`  anchor1 (calLineFor): ${a1}, anchor2 (B19a block): ${a2}`);
  if (a1 !== 1 || a2 !== 1) {
    console.error('  ABORT: anchors not found exactly once — live code drifted, manual review needed');
    return false;
  }

  code = code.replace(A1, R1).replace(A2, R2);

  const checks = {
    helper_present:      countOf(code, 'function _proposeHoraFor(') === 1,
    ranges_present:      countOf(code, 'function _openRangesFor(') === 1,
    b19a_uses_validated: code.includes('const _b19aHora = _proposeHoraFor(_b19aNext, f.hora);'),
    no_blind_copy:       countOf(code, 'if (f.hora) _sess.proposedHora = f.hora;') === 0,
    marker_twice:        countOf(code, 'closed-day-propose-real-hour') === 2, // 1 in each comment block
  };
  console.log('  pre-PUT checks:', JSON.stringify(checks));
  if (!Object.values(checks).every(Boolean)) {
    console.error('  ABORT: post-replace invariants failed');
    return false;
  }
  if (!isParseable(code)) return false;

  // Backup the live workflow before PUT
  const backupPath = new URL(`../N8N/_menu_work/LIVE_backup_${key}_pre-closedday-fix.json`, import.meta.url);
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

  // Re-GET and verify
  const after = await api('GET', t.id);
  const codeAfter = (after.nodes || []).find((n) => n.name === NODE)?.parameters?.jsCode || '';
  const ok = codeAfter.includes('closed-day-propose-real-hour') && !codeAfter.includes('if (f.hora) _sess.proposedHora = f.hora;');
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
