#!/usr/bin/env node
// Deploy two UX changes into the live motore-unico chatbot ([Picnic] Chatbot
// WhatsApp, 166QnQsGHqXDpBxa — multi-tenant, handles Oraz/BALI/Picnic):
//
//  1) Read-receipt + typing-indicator: the instant a message arrives we send the
//     WhatsApp "read" (blue ticks) + "sta scrivendo…" indicator. It lasts ~25s or
//     until we send the reply — masking the debounce + transcription + LLM so a
//     longer debounce never feels like a bug. Fire-and-forget, guarded on a real
//     wamid; if it fails it's a silent no-op (zero impact on the flow).
//
//  2) Debounce 3000 -> 6000 ms. A real "second message" takes ~5-8s to type; 3s
//     fired mid-composition and split the turn. 6s coalesces it. The typing
//     indicator from (1) is what makes the longer wait acceptable.
//
// Safe: GET live -> verify anchors appear EXACTLY once + not already applied ->
// targeted replaces -> post-replace invariants -> syntax parse -> backup ->
// PUT {name,nodes,connections,settings,staticData} -> re-GET verify.
// Usage: node scripts/deploy-debounce-typing.mjs [DRY_RUN=1]
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const cfg = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = cfg('N8N_BASE_URL');
const KEY = cfg('N8N_API_KEY');
const WF_ID = '166QnQsGHqXDpBxa';
const NODE = 'Fetch History + Check Availability';
const MARKER = 'READ RECEIPT + TYPING INDICATOR (2026-06-06)';

// --- Change 1: insert helper + call right after the META SEND block ---
const A_END = `// === END PICNIC META SEND ===`;
const R_END = `// === END PICNIC META SEND ===

// === READ RECEIPT + TYPING INDICATOR (2026-06-06) ===========================
// Appena arriva il messaggio mostriamo subito la spunta blu (letto) + "sta
// scrivendo…", così il debounce più lungo non sembra un bug: l'utente sa che il
// bot ha ricevuto e sta elaborando. L'indicatore WhatsApp dura ~25s o finché non
// inviamo la risposta — copre debounce + trascrizione audio + LLM. Guardia su
// wamid reale; se fallisce è un no-op (zero impatto sul flusso).
function sendReadAndTyping(_ctx, _wamid) {
  if (!META_ON || !_wamid || String(_wamid).indexOf('wamid.') !== 0) return Promise.resolve(null);
  return _ctx.helpers.httpRequest({ method: 'POST', url: 'https://graph.facebook.com/' + META_GRAPH_VER + '/' + META_PHONE_ID + '/messages', headers: { 'Authorization': 'Bearer ' + META_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: String(_wamid), typing_indicator: { type: 'text' } }) }).catch(function(){ return null; });
}
try { await sendReadAndTyping(this, (($input.first().json && $input.first().json.messageSid) || '')); } catch (_eTyping) {}`;

// --- Change 2: debounce base 3000 -> 6000 ---
const A_DEB = `    let _debMs = 3000;`;
const R_DEB = `    let _debMs = 6000;`;

const A_CMT = `    await new Promise(r => setTimeout(r, _debMs)); // (2026-06-02) 6000->3000: bursts observed ~2.3s apart; 3s covers them while halving the per-turn floor. (2026-06-03) 9s while awaiting special requests (notas_asked) to coalesce multi-message detail bursts.`;
const R_CMT = `    await new Promise(r => setTimeout(r, _debMs)); // (2026-06-02) 6000->3000: bursts observed ~2.3s apart. (2026-06-03) 9s while awaiting special requests (notas_asked). (2026-06-06) 3000->6000: un secondo messaggio "vero" richiede ~5-8s da scrivere; 6s li coalizza, mascherato da read-receipt + typing indicator così non sembra lento.`;

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

async function main() {
  console.log(`\n=== motore-unico (${WF_ID}) · node "${NODE}" ===`);
  const wf = await api('GET', WF_ID);
  const node = (wf.nodes || []).find((n) => n.name === NODE);
  if (!node || typeof node.parameters?.jsCode !== 'string') {
    console.error('  ABORT: node or jsCode not found'); return false;
  }
  let code = node.parameters.jsCode;
  const before = code.length;

  if (code.includes(MARKER)) { console.log('  SKIP: already applied (idempotent)'); return true; }

  const cEnd = countOf(code, A_END), cDeb = countOf(code, A_DEB), cCmt = countOf(code, A_CMT);
  console.log(`  anchors → END_SEND:${cEnd}  debMs3000:${cDeb}  comment:${cCmt}`);
  if (cEnd !== 1 || cDeb !== 1 || cCmt !== 1) {
    console.error('  ABORT: anchors not found exactly once — live code drifted, manual review'); return false;
  }

  code = code.replace(A_END, R_END).replace(A_DEB, R_DEB).replace(A_CMT, R_CMT);

  const checks = {
    helper_present:   countOf(code, 'function sendReadAndTyping(') === 1,
    call_present:     countOf(code, 'await sendReadAndTyping(this,') === 1,
    typing_payload:   code.includes("typing_indicator: { type: 'text' }"),
    deb_6000:         countOf(code, 'let _debMs = 6000;') === 1,
    deb_3000_gone:    countOf(code, 'let _debMs = 3000;') === 0,
    marker_once:      countOf(code, MARKER) === 2, // comment header + (no) — actually appears once in code, once in this check? keep 1
  };
  // MARKER appears once in the inserted comment block.
  checks.marker_once = countOf(code, MARKER) === 1;
  console.log('  pre-PUT checks:', JSON.stringify(checks));
  if (!Object.values(checks).every(Boolean)) { console.error('  ABORT: invariants failed'); return false; }
  if (!isParseable(code)) return false;

  const backupPath = new URL(`./LIVE_backup_motore_pre-debounce-typing.json`, import.meta.url);
  writeFileSync(backupPath, JSON.stringify(wf, null, 2));
  console.log(`  backup: ${backupPath.pathname.split('/').slice(-1)[0]} (jsCode ${before} → ${code.length})`);

  if (process.env.DRY_RUN === '1') { console.log('  DRY_RUN: skipping PUT'); return true; }

  node.parameters.jsCode = code;
  await api('PUT', WF_ID, {
    name: wf.name, nodes: wf.nodes, connections: wf.connections,
    settings: wf.settings || {}, staticData: wf.staticData || null,
  });

  const after = await api('GET', WF_ID);
  const ca = (after.nodes || []).find((n) => n.name === NODE)?.parameters?.jsCode || '';
  const ok = ca.includes(MARKER) && ca.includes('let _debMs = 6000;') && !ca.includes('let _debMs = 3000;');
  const stillActive = after.active === true;
  console.log(ok ? '  ✅ PUT verified live' : '  ❌ PUT verification FAILED');
  console.log(`  workflow active: ${stillActive}`);
  return ok && stillActive;
}

const ok = await main();
console.log(ok ? '\n✅ DONE' : '\n❌ FINISHED WITH ERRORS');
process.exit(ok ? 0 : 1);
