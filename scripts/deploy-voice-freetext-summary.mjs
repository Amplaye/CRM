#!/usr/bin/env node
// Deploy: make the VOICE Book Logic send the SAME free-text confirmation card the
// chat sends, instead of the booking_reminder template. WhatsApp allows free text
// inside the guest's 24h window (which exists whenever they've messaged the
// number — the usual case), so the voice summary should match the chat exactly.
// A template is only needed when there is NO open window (a voice-only guest who
// never messaged): in that case we fall back to the approved booking_confirmation
// template. This replaces the whole `if (!_isPlaceholderWa) { … }` send block.
//
// Safe: GET live -> backup -> locate the block by its exact head/tail anchors
// (ABORT unless each appears once) -> slice-replace -> verify the new markers
// are present and the old template send is gone -> PUT. Set DRY_RUN=1 to skip PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = 'KLRgoVjOp9iZfr2R';
const NODE = 'Book Logic';

const HEAD = `    if (!_isPlaceholderWa) {`;
const TAIL = `  } catch (_eWa) {}`;

const NEW_BLOCK = `    if (!_isPlaceholderWa) {
      const _send = (payload) => this.helpers.httpRequest({
        method: 'POST',
        url: 'https://graph.facebook.com/v21.0/' + _META_PHONE_ID + '/messages',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _META_TOKEN },
        body: JSON.stringify(payload),
      });
      // Build the SAME confirmation card the chat sends, in the caller's language.
      const _Lc = getPicnicTemplates(idioma);
      const _zlbl = (zona === 'interior' || zona === 'inside') ? _Lc.zoneInterior : (zona === 'exterior' || zona === 'outside') ? _Lc.zoneExterior : '';
      const _zline = _zlbl ? '\\n' + _Lc.zone + ' ' + _zlbl : '';
      const _nline = notas ? '\\n' + _Lc.notes + ' ' + notas : '';
      const _card = _Lc.confirmedTitle + '\\n' + _Lc.date + ' ' + formatDateFull(fecha, idioma) + '\\n' + _Lc.time + ' ' + String((hora || '').slice(0, 5)) + '\\n' + _Lc.people + ' ' + personas + _zline + '\\n' + _Lc.name + ' ' + (nombre || '') + _nline + '\\n\\n' + (_Lc.modCancelInstr || _Lc.cancelOnlyInstructions || '');
      try {
        // Free text first — arrives whenever the guest has an open 24h window
        // (exactly how the chat does it). Identical card, no reminder template.
        await _send({ messaging_product: 'whatsapp', to: _waTo, type: 'text', text: { body: _card } });
      } catch (_eFree) {
        // No open window (voice-only guest who never messaged): Meta blocks free
        // text, so fall back to the approved booking_confirmation template.
        try {
          await _send({ messaging_product: 'whatsapp', to: _waTo, type: 'template', template: {
            name: 'booking_confirmation', language: { code: idioma }, components: [{ type: 'body', parameters: [
              { type: 'text', text: String(nombre || 'Cliente') },
              { type: 'text', text: String(formatDateFull(fecha, idioma)) },
              { type: 'text', text: String((hora || '').slice(0, 5)) },
              { type: 'text', text: String(personas) },
              { type: 'text', text: String(RESTAURANT_NAME_CFG) }
            ] }] } });
        } catch (_eTpl) {}
      }
    }
`;

const countOf = (s, sub) => s.split(sub).length - 1;

async function n8n(method, path, body) {
  const r = await fetch(`${BASE}/api/v1/workflows/${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} — ${await r.text()}`);
  return r.json();
}

const wf = await n8n('GET', ID);
const stamp = process.env.STAMP || 'manual';
writeFileSync(
  new URL(`../N8N/Voice_${ID}.LIVE_backup_pre_freetext-summary_${stamp}.json`, import.meta.url),
  JSON.stringify(wf, null, 2),
);

const node = (wf.nodes || []).find((n) => n.name === NODE);
let code = node?.parameters?.jsCode;
if (typeof code !== 'string') { console.error('ABORT: node/jsCode not found'); process.exit(1); }

if (code.includes('type: \'text\', text: { body: _card }')) {
  console.error('ABORT: free-text summary already deployed');
  process.exit(1);
}
const start = code.indexOf(HEAD);
const tailIdx = code.indexOf(TAIL, start);
if (start < 0 || tailIdx < 0) { console.error('ABORT: head/tail anchors not found'); process.exit(1); }
if (countOf(code, HEAD) !== 1) { console.error(`ABORT: HEAD anchor found ${countOf(code, HEAD)} times`); process.exit(1); }
// Sanity: the slice we're replacing must be the booking_reminder template send.
const slice = code.slice(start, tailIdx);
if (!slice.includes(`name: 'booking_reminder',`)) { console.error('ABORT: slice is not the expected template-send block'); process.exit(1); }

code = code.slice(0, start) + NEW_BLOCK + code.slice(tailIdx);

if (!code.includes("type: 'text', text: { body: _card }")) { console.error('ABORT: free-text send missing after edit'); process.exit(1); }
if (!code.includes("name: 'booking_confirmation'")) { console.error('ABORT: template fallback missing after edit'); process.exit(1); }
if (code.includes(`name: 'booking_reminder',`)) { console.error('ABORT: booking_reminder send still present'); process.exit(1); }
node.parameters.jsCode = code;

if (process.env.DRY_RUN) {
  console.log('DRY_RUN: edit verified, not writing. New block preview:');
  console.log(code.slice(start, start + 700));
  process.exit(0);
}

await n8n('PUT', ID, {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
  staticData: wf.staticData ?? null,
});
console.log('PUT ok — voice flow now sends the free-text chat card (template fallback for no-window).');
