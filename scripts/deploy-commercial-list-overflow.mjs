#!/usr/bin/env node
// Deploy C — Commercial-info proactive: support >3 offers.
// Meta "reply buttons" sono max 3, quindi con 4+ articoli 'commerciale' l'ultimo
// (es. "torte" su Oraz) veniva tagliato. Fix: quando le offerte sono >3 il bot manda
// un messaggio interattivo di tipo LIST (fino a 10 righe) invece dei bottoni; <=3 resta
// a bottoni (UX inline migliore). Il tap su una riga torna come interactive.list_reply
// (title->message, id->buttonPayload) e si comporta ESATTAMENTE come un bottone.
//
// Tocca 3 nodi:
//   OpenAI  : cap offerte 3 -> 10; passa interactiveListLabel localizzata.
//   Send    : sendWhatsAppList() + branch list-vs-buttons (>3 -> list).
//   Extract : buttonPayload legge anche interactive.list_reply.id (no re-trigger guard).
//
// Safe: GET -> backup -> per-anchor count===1 (else ABORT) -> replaces -> invariants ->
// `node --check` -> PUT. DRY_RUN=1 salta il PUT (scrive i nodi patchati).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = '166QnQsGHqXDpBxa';
const countOf = (s, sub) => s.split(sub).length - 1;

// ---------- OpenAI node ----------
const OA_CAP_ANCHOR = `var _coButtons = _commOffers.slice(0, 3).map(function(t){`;
const OA_CAP_CODE = `var _coButtons = _commOffers.slice(0, 10).map(function(t){`;

const OA_RET_ANCHOR = `return [{ json: { ...input, aiResponse: _coText, interactiveButtons: _coButtons, bookingData: null, modifyData: null, waitlistData: null, toolCallsCount: 0, commercialOffered: true } }];`;
const OA_RET_CODE = `var _coListLabel = ({ it: 'Vedi le opzioni', es: 'Ver opciones', en: 'See options', de: 'Optionen ansehen' })[RESPOND_LANG] || 'Ver opciones';
    return [{ json: { ...input, aiResponse: _coText, interactiveButtons: _coButtons, interactiveListLabel: _coListLabel, bookingData: null, modifyData: null, waitlistData: null, toolCallsCount: 0, commercialOffered: true } }];`;

// ---------- Send node ----------
const SEND_FN_ANCHOR = `function sendWhatsAppButtons(_ctx, to, body, buttons) {`;
const SEND_FN_CODE = String.raw`function sendWhatsAppList(_ctx, to, body, buttons, btnLabel) {
  // Meta interactive "list" (fino a 10 righe): usato quando le offerte commerciali
  // superano i 3 bottoni reply. Il tap torna come interactive.list_reply
  // (title->message, id->buttonPayload), identico ai bottoni -> stessa risposta dalla KB.
  var _to = String(to || '').replace('whatsapp:', '').replace(/[^0-9]/g, '');
  var _rows = (Array.isArray(buttons) ? buttons : []).filter(function(b){ return b && b.title; }).slice(0, 10)
    .map(function(b, _i){ return { id: String(b.id || ('opt' + _i)).slice(0, 200), title: String(b.title).slice(0, 24) }; });
  if (!_to || !body || _rows.length === 0) return Promise.resolve(null);
  var _label = String(btnLabel || 'Opzioni').slice(0, 20);
  return _ctx.helpers.httpRequest({ method: 'POST', url: 'https://graph.facebook.com/' + META_GRAPH_VER + '/' + META_PHONE_ID + '/messages', headers: { 'Authorization': 'Bearer ' + META_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: _to, type: 'interactive', interactive: { type: 'list', body: { text: String(body) }, action: { button: _label, sections: [{ title: _label.slice(0, 24), rows: _rows }] } } }) });
}
` + SEND_FN_ANCHOR;

const SEND_SLICE_ANCHOR = `.filter(function(b){ return b && b.title; }).slice(0, 3) : [];`;
const SEND_SLICE_CODE = `.filter(function(b){ return b && b.title; }).slice(0, 10) : [];`;

const SEND_TERN_ANCHOR = `      ? await sendWhatsAppButtons(this, _recipient, input.cleanResponse, _coBtns)`;
const SEND_TERN_CODE = `      ? (_coBtns.length > 3 ? await sendWhatsAppList(this, _recipient, input.cleanResponse, _coBtns, input.interactiveListLabel) : await sendWhatsAppButtons(this, _recipient, input.cleanResponse, _coBtns))`;

// ---------- Extract Message (set node) buttonPayload assignment ----------
const EX_ANCHOR = `if(m.interactive&&m.interactive.button_reply&&m.interactive.button_reply.id) return m.interactive.button_reply.id; return '';`;
const EX_CODE = `if(m.interactive&&m.interactive.button_reply&&m.interactive.button_reply.id) return m.interactive.button_reply.id; if(m.interactive&&m.interactive.list_reply&&m.interactive.list_reply.id) return m.interactive.list_reply.id; return '';`;

// ---------- apply ----------
async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/v1/workflows/${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} — ${await r.text()}`);
  return r.json();
}

function syntaxOk(jsCode, label) {
  const f = join(tmpdir(), `n8ncheck_${label.replace(/\W/g, '')}.js`);
  writeFileSync(f, '(async function(){\n' + jsCode + '\n});\n');
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); return true; }
  catch (e) { console.error(`SYNTAX ERROR in ${label}:\n` + (e.stderr ? e.stderr.toString() : e.message)); return false; }
}

const wf = await api('GET', ID);
const stamp = process.env.STAMP || 'manual';
writeFileSync(new URL(`../N8N/picnic/Chatbot_166.LIVE_backup_pre_commercial-list-overflow_${stamp}.json`, import.meta.url), JSON.stringify(wf, null, 2));

const oa = (wf.nodes || []).find((n) => n.name === 'OpenAI');
const sn = (wf.nodes || []).find((n) => n.name === 'Send WhatsApp Reply');
const ex = (wf.nodes || []).find((n) => n.name === 'Extract Message');
if (!oa?.parameters?.jsCode || !sn?.parameters?.jsCode) { console.error('ABORT: OpenAI/Send jsCode not found'); process.exit(1); }
const exAssignments = ex?.parameters?.assignments?.assignments;
if (!Array.isArray(exAssignments)) { console.error('ABORT: Extract Message assignments not found'); process.exit(1); }
const exBp = exAssignments.find((a) => a.name === 'buttonPayload');
if (!exBp || typeof exBp.value !== 'string') { console.error('ABORT: buttonPayload assignment not found'); process.exit(1); }

let oaCode = oa.parameters.jsCode;
let snCode = sn.parameters.jsCode;
let exVal = exBp.value;

// Idempotency
if (oaCode.includes('interactiveListLabel') || snCode.includes('sendWhatsAppList') || exVal.includes('list_reply.id')) {
  console.error('ABORT: list-overflow already present'); process.exit(1);
}

const anchorList = [
  ['OA_CAP', oaCode, OA_CAP_ANCHOR], ['OA_RET', oaCode, OA_RET_ANCHOR],
  ['SEND_FN', snCode, SEND_FN_ANCHOR], ['SEND_SLICE', snCode, SEND_SLICE_ANCHOR], ['SEND_TERN', snCode, SEND_TERN_ANCHOR],
  ['EX_BP', exVal, EX_ANCHOR],
];
for (const [label, src, anchor] of anchorList) {
  const c = countOf(src, anchor);
  if (c !== 1) { console.error(`ABORT: anchor ${label} count is ${c}, expected exactly 1`); process.exit(1); }
}

oaCode = oaCode.replace(OA_CAP_ANCHOR, OA_CAP_CODE).replace(OA_RET_ANCHOR, OA_RET_CODE);
snCode = snCode.replace(SEND_FN_ANCHOR, SEND_FN_CODE).replace(SEND_SLICE_ANCHOR, SEND_SLICE_CODE).replace(SEND_TERN_ANCHOR, SEND_TERN_CODE);
exVal = exVal.replace(EX_ANCHOR, EX_CODE);

const checks = {
  oa_cap_10: countOf(oaCode, '_commOffers.slice(0, 10)') === 1,
  oa_label_1: countOf(oaCode, 'interactiveListLabel: _coListLabel') === 1,
  oa_offer_intact: countOf(oaCode, 'commercialOffered: true') === 1,
  oa_pause_intact: countOf(oaCode, 'botPaused: true') === 1,
  send_list_fn_1: countOf(snCode, 'function sendWhatsAppList') === 1,
  send_btn_fn_intact: countOf(snCode, 'function sendWhatsAppButtons') === 1,
  send_slice_10: countOf(snCode, '.slice(0, 10) : [];') === 1,
  send_tern_list_1: countOf(snCode, 'await sendWhatsAppList(this, _recipient') === 1,
  send_text_fallback_intact: countOf(snCode, 'await sendWhatsApp(this, _recipient, input.cleanResponse)') === 1,
  ex_list_reply_1: countOf(exVal, 'return m.interactive.list_reply.id;') === 1,
};
console.log('pre-PUT checks:', JSON.stringify(checks, null, 0));
if (!Object.values(checks).every(Boolean)) { console.error('ABORT: invariants failed'); process.exit(1); }
if (!syntaxOk(oaCode, 'OpenAI') || !syntaxOk(snCode, 'SendWhatsAppReply')) { console.error('ABORT: syntax check failed'); process.exit(1); }

oa.parameters.jsCode = oaCode;
sn.parameters.jsCode = snCode;
exBp.value = exVal;
writeFileSync(new URL('../N8N/picnic/_patched_OpenAI_commercial_listoverflow.js', import.meta.url), oaCode);
writeFileSync(new URL('../N8N/picnic/_patched_Send_commercial_listoverflow.js', import.meta.url), snCode);

if (process.env.DRY_RUN === '1') { console.log('DRY_RUN: skipping PUT (patched nodes written)'); process.exit(0); }

await api('PUT', ID, { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {}, staticData: wf.staticData || null });
console.log('PUT ok');
