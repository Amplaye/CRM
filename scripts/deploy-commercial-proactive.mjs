#!/usr/bin/env node
// Deploy B — Commercial-info module, proactive discoverability:
//   OpenAI node:
//     1) GUARD "offerta commerciale proattiva": flag-gated; on an occasion word or a
//        large-group signal, reply with tappable buttons built from the tenant's
//        published `commerciale` titles (skips the LLM that turn, like the bot_paused
//        / event-request guards). The tap sends the title back as a normal message →
//        reactive answer from the KB. Anti-repetition via an invisible signature.
//     2) Welcome/soft discoverability: a conditional system message telling the model
//        it MAY offer the commercial info (set menus, buffet, cakes) when relevant.
//   Send node:
//     3) sendWhatsAppButtons() (Meta interactive reply buttons) + branch to use it
//        when interactiveButtons are present (Twilio/no-Meta falls back to text).
// Generic + flag-gated: only a tenant with commercial_info_enabled ON (today: Oraz)
// ever triggers any of this; every other tenant is byte-for-byte unaffected.
//
// Safe pattern: GET -> backup -> per-anchor count===1 (else ABORT) -> replaces ->
// invariants -> wrapped `node --check` of both nodes -> PUT. DRY_RUN=1 skips PUT.
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
const OA_GUARD_ANCHOR = `const OPENAI_KEY = picnicCfgGet(_bc, 'openai_key', '');`;
const OA_GUARD_CODE = String.raw`// === GUARD: OFFERTA COMMERCIALE PROATTIVA (modulo "Listini & Info") ===
// [commercial-offer] Flag-gated (commercial_info_enabled; oggi solo chi l'ha acceso).
// Modulo ON + articoli 'commerciale' pubblicati -> il bot PROPONE le opzioni con
// bottoni tappabili appena coglie un segnale, senza spammare. Segnali: (a) parola-
// occasione (compleanno/festa/evento/laurea/comunione…), (b) gruppo numeroso >= soglia.
// Etichette bottoni = titoli articoli (max 3, <=20 char: limite Meta reply buttons).
// Il tap rimanda il TITOLO come messaggio normale -> risposta reattiva dalla KB.
// Anti-ripetizione: firma invisibile ⁤ in coda; non rilancia se appena offerto.
var _commOffers = Array.isArray(input.commercialOffers) ? input.commercialOffers.filter(function(t){ return t && String(t).trim(); }) : [];
if (input.commercialOn === true && _commOffers.length > 0 && !input.buttonPayload) {
  var _coMsg = String(input.message || '').toLowerCase();
  var _coOccasion = /(complean|festeggia|festa\b|fiesta|cumplea|anivers|anniversari|laure|comunion|comunione|battesim|cresim|despedida|birthday|anniversary|graduation|baptism|communion|geburtstag|jubil[äa]um|feier|hochzeit|\bboda\b|matrimonio|catering|banchett|banquet|buffet)/i.test(_coMsg);
  var _coGroupN = 0;
  try {
    var _m1 = _coMsg.match(/(\d{1,3})\s*(person|persone|personas|people|pax|ospiti|gente|leute|personen|comensales|invitad)/);
    var _m2 = _coMsg.match(/(?:siamo in|semo in|somos|we are|wir sind|tavolo (?:da|per)|mesa para|table for|tisch für)\s*(\d{1,3})/);
    if (_m1) _coGroupN = parseInt(_m1[1], 10) || 0;
    if (!_coGroupN && _m2) _coGroupN = parseInt(_m2[1], 10) || 0;
  } catch(_eG) {}
  var _coGroup = _coGroupN >= (LARGE_THRESHOLD_CFG || 7);
  var _coAlready = false;
  try {
    var _coHist = JSON.parse(input.history || '[]');
    for (var _ci = _coHist.length - 1; _ci >= 0 && _ci >= _coHist.length - 2; _ci--) {
      var _ch = _coHist[_ci];
      if (_ch && _ch.role === 'assistant' && String(_ch.content || '').indexOf('⁤') >= 0) { _coAlready = true; break; }
    }
  } catch(_eH) {}
  if ((_coOccasion || _coGroup) && !_coAlready) {
    var _coButtons = _commOffers.slice(0, 3).map(function(t){
      var _ti = String(t).trim();
      return { id: 'COMM:' + _ti.slice(0, 230), title: _ti.slice(0, 20) };
    });
    var _coLeadMap = _coGroup ? {
      it: 'Per i gruppi abbiamo menù fissi, buffet e torte: vuoi che ti mandi i dettagli? Tocca un\'opzione 👇',
      es: 'Para grupos tenemos menús cerrados, bufé y tartas: ¿te paso los detalles? Toca una opción 👇',
      en: 'For groups we have set menus, buffet and cakes: want the details? Tap an option 👇',
      de: 'Für Gruppen haben wir feste Menüs, Buffet und Torten: soll ich dir die Details schicken? Tippe eine Option 👇'
    } : {
      it: 'Se festeggi qualcosa posso mandarti menù, buffet e listino torte 🎂 Tocca un\'opzione 👇',
      es: 'Si celebras algo, puedo enviarte menús, bufé y lista de tartas 🎂 Toca una opción 👇',
      en: 'If you\'re celebrating something, I can send you menus, buffet and cake list 🎂 Tap an option 👇',
      de: 'Wenn du etwas feierst, schicke ich dir gern Menüs, Buffet und Tortenliste 🎂 Tippe eine Option 👇'
    };
    var _coText = (_coLeadMap[RESPOND_LANG] || _coLeadMap.es) + '⁤';
    return [{ json: { ...input, aiResponse: _coText, interactiveButtons: _coButtons, bookingData: null, modifyData: null, waitlistData: null, toolCallsCount: 0, commercialOffered: true } }];
  }
}

` + OA_GUARD_ANCHOR;

const OA_MSG_ANCHOR = `const messages = [{ role: 'system', content: systemPrompt }];`;
const OA_MSG_CODE = OA_MSG_ANCHOR + String.raw`
// [commercial-info] Discoverability soft (flag-gated): modulo ON + offerte presenti ->
// istruisci il modello a far sapere con naturalezza (senza spingere) che può
// inviare listini/menù/buffet/torte quando il contesto lo suggerisce. Saluto != intento.
if (input.commercialOn === true && Array.isArray(input.commercialOffers) && input.commercialOffers.length > 0) {
  messages.push({ role: 'system', content: 'INFO COMMERCIALI DISPONIBILI: il ristorante può inviare ' + input.commercialOffers.join(', ') + '. Se il cliente accenna a un\'occasione (compleanno, festa, evento), a un gruppo numeroso, o al primo contatto chiede in modo vago in cosa puoi aiutarlo, FAGLI SAPERE con naturalezza che puoi mandargli queste info (menù di gruppo, buffet, listino torte) e chiedi quale gli interessa, UNA sola volta e senza insistere. Se chiede esplicitamente di una di queste (torta, menù fissi, buffet, listino), rispondi usando la BASE DE CONOCIMIENTO. Rispondi sempre nella lingua del cliente.' });
}`;

// ---------- Send node ----------
const SEND_FN_ANCHOR = `const _SUPA_BM = 'https://azhlnybiqlkbhbboyvud.supabase.co/rest/v1/bot_messages';`;
const SEND_FN_CODE = String.raw`function sendWhatsAppButtons(_ctx, to, body, buttons) {
  // Meta interactive "reply buttons" (<=3, title <=20 char). Solo Meta; senza Meta
  // il chiamante fa fallback a sendWhatsApp (testo). Usato per le offerte proattive
  // commerciali: il tap torna come interactive.button_reply (title->message, id->buttonPayload).
  var _to = String(to || '').replace('whatsapp:', '').replace(/[^0-9]/g, '');
  var _btns = (Array.isArray(buttons) ? buttons : []).filter(function(b){ return b && b.title; }).slice(0, 3)
    .map(function(b, _i){ return { type: 'reply', reply: { id: String(b.id || ('opt' + _i)).slice(0, 256), title: String(b.title).slice(0, 20) } }; });
  if (!_to || !body || _btns.length === 0) return Promise.resolve(null);
  return _ctx.helpers.httpRequest({ method: 'POST', url: 'https://graph.facebook.com/' + META_GRAPH_VER + '/' + META_PHONE_ID + '/messages', headers: { 'Authorization': 'Bearer ' + META_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: _to, type: 'interactive', interactive: { type: 'button', body: { text: String(body) }, action: { buttons: _btns } } }) });
}
` + SEND_FN_ANCHOR;

const SEND_BRANCH_ANCHOR = `    const _r = await sendWhatsApp(this, _recipient, input.cleanResponse);`;
const SEND_BRANCH_CODE = String.raw`    var _coBtns = Array.isArray(input.interactiveButtons) ? input.interactiveButtons.filter(function(b){ return b && b.title; }).slice(0, 3) : [];
    const _r = (_coBtns.length > 0 && META_PHONE_ID && META_TOKEN)
      ? await sendWhatsAppButtons(this, _recipient, input.cleanResponse, _coBtns)
      : await sendWhatsApp(this, _recipient, input.cleanResponse);`;

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

// Syntax-check an n8n Code-node body by wrapping it as an async function file and
// running `node --check` (the body uses top-level await, valid only inside async).
// execFileSync (no shell) — args are a literal flag + our own temp path.
function syntaxOk(jsCode, label) {
  const f = join(tmpdir(), `n8ncheck_${label.replace(/\W/g, '')}.js`);
  writeFileSync(f, '(async function(){\n' + jsCode + '\n});\n');
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); return true; }
  catch (e) { console.error(`SYNTAX ERROR in ${label}:\n` + (e.stderr ? e.stderr.toString() : e.message)); return false; }
}

const wf = await api('GET', ID);
const stamp = process.env.STAMP || 'manual';
writeFileSync(new URL(`../N8N/picnic/Chatbot_166.LIVE_backup_pre_commercial-proactive_${stamp}.json`, import.meta.url), JSON.stringify(wf, null, 2));

const oa = (wf.nodes || []).find((n) => n.name === 'OpenAI');
const sn = (wf.nodes || []).find((n) => n.name === 'Send WhatsApp Reply');
if (!oa?.parameters?.jsCode || !sn?.parameters?.jsCode) { console.error('ABORT: node/jsCode not found'); process.exit(1); }

let oaCode = oa.parameters.jsCode;
let snCode = sn.parameters.jsCode;

if (oaCode.includes('[commercial-offer]') || snCode.includes('sendWhatsAppButtons')) {
  console.error('ABORT: commercial-proactive already present'); process.exit(1);
}
const anchorList = [
  ['OA_GUARD', oaCode, OA_GUARD_ANCHOR], ['OA_MSG', oaCode, OA_MSG_ANCHOR],
  ['SEND_FN', snCode, SEND_FN_ANCHOR], ['SEND_BRANCH', snCode, SEND_BRANCH_ANCHOR],
];
for (const [label, src, anchor] of anchorList) {
  const c = countOf(src, anchor);
  if (c !== 1) { console.error(`ABORT: anchor ${label} count is ${c}, expected exactly 1`); process.exit(1); }
}

oaCode = oaCode.replace(OA_GUARD_ANCHOR, OA_GUARD_CODE).replace(OA_MSG_ANCHOR, OA_MSG_CODE);
snCode = snCode.replace(SEND_FN_ANCHOR, SEND_FN_CODE).replace(SEND_BRANCH_ANCHOR, SEND_BRANCH_CODE);

const checks = {
  oa_guard_1: countOf(oaCode, '[commercial-offer]') === 1,
  oa_guard_return: countOf(oaCode, 'commercialOffered: true') === 1,
  oa_msg_1: countOf(oaCode, 'INFO COMMERCIALI DISPONIBILI') === 1,
  oa_pause_intact: countOf(oaCode, 'botPaused: true') === 1,
  oa_event_intact: countOf(oaCode, 'privateEventDeflected: true') === 1,
  send_fn_1: countOf(snCode, 'function sendWhatsAppButtons') === 1,
  send_branch_1: countOf(snCode, 'await sendWhatsAppButtons(this, _recipient') === 1,
  send_text_fallback_intact: countOf(snCode, 'await sendWhatsApp(this, _recipient, input.cleanResponse)') === 1,
};
console.log('pre-PUT checks:', JSON.stringify(checks, null, 0));
if (!Object.values(checks).every(Boolean)) { console.error('ABORT: invariants failed'); process.exit(1); }
if (!syntaxOk(oaCode, 'OpenAI') || !syntaxOk(snCode, 'SendWhatsAppReply')) { console.error('ABORT: syntax check failed'); process.exit(1); }

oa.parameters.jsCode = oaCode;
sn.parameters.jsCode = snCode;
writeFileSync(new URL('../N8N/picnic/_patched_OpenAI_commercial_proactive.js', import.meta.url), oaCode);
writeFileSync(new URL('../N8N/picnic/_patched_Send_commercial_proactive.js', import.meta.url), snCode);

if (process.env.DRY_RUN === '1') { console.log('DRY_RUN: skipping PUT (patched nodes written)'); process.exit(0); }

await api('PUT', ID, { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {}, staticData: wf.staticData || null });
console.log('PUT ok');
