#!/usr/bin/env node
// Deploy: add the venue ADDRESS (+ maps link) and PARKING to the voice booking
// confirmation card, so the summary matches what a guest needs — mirroring the
// chat's venue recap. Data comes from the tenant's `venue` config
// (address/city/parking), already available via picnicCfgGet(_bc,'venue').
// Notes (allergies etc.) already render via the _nline added earlier.
//
// Safe: GET live -> backup -> verify both anchors appear once -> 2 replaces ->
// verify markers present -> PUT. Set DRY_RUN=1 to skip PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = 'KLRgoVjOp9iZfr2R';
const NODE = 'Book Logic';
const countOf = (s, sub) => s.split(sub).length - 1;

const NLINE_ANCHOR = `      const _nline = notas ? '\\n' + _Lc.notes + ' ' + notas : '';\n`;
const VENUE_BLOCK = `      const _vcfg = picnicCfgGet(_bc, 'venue', {}) || {};
      const _vL = ({
        it: { addr: '🗺️ Indirizzo:', park: '🅿️ Parcheggio:', pk: { street: 'in strada', own: 'proprio del locale', public: 'pubblico vicino' } },
        es: { addr: '🗺️ Dirección:', park: '🅿️ Aparcamiento:', pk: { street: 'en la calle', own: 'propio', public: 'público cerca' } },
        en: { addr: '🗺️ Address:', park: '🅿️ Parking:', pk: { street: 'on-street', own: 'own', public: 'public nearby' } },
        de: { addr: '🗺️ Adresse:', park: '🅿️ Parkplatz:', pk: { street: 'Straße', own: 'eigener', public: 'öffentlich in der Nähe' } },
      })[idioma] || { addr: '🗺️', park: '🅿️', pk: {} };
      const _addr = [_vcfg.address, _vcfg.city].map(function(x){ return String(x || '').trim(); }).filter(Boolean).join(', ');
      const _aline = _addr ? '\\n' + _vL.addr + ' ' + _addr + '\\nhttps://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(_addr) : '';
      const _pk = (Array.isArray(_vcfg.parking) ? _vcfg.parking : []).filter(function(k){ return k && k !== 'none'; });
      const _pline = _pk.length ? '\\n' + _vL.park + ' ' + _pk.map(function(k){ return _vL.pk[k] || k; }).join(', ') : '';
      const _venueLine = _aline + _pline;
`;

const CARD_ANCHOR = `+ _nline + '\\n\\n' + (_Lc.modCancelInstr`;
const CARD_REPLACE = `+ _nline + _venueLine + '\\n\\n' + (_Lc.modCancelInstr`;

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
writeFileSync(
  new URL(`../N8N/Voice_${ID}.LIVE_backup_pre_summary-address-parking_${process.env.STAMP || 'manual'}.json`, import.meta.url),
  JSON.stringify(wf, null, 2),
);
const node = (wf.nodes || []).find((n) => n.name === NODE);
let code = node?.parameters?.jsCode;
if (typeof code !== 'string') { console.error('ABORT: node/jsCode not found'); process.exit(1); }
if (code.includes('_venueLine')) { console.error('ABORT: venue recap already present'); process.exit(1); }
if (countOf(code, NLINE_ANCHOR) !== 1) { console.error(`ABORT: _nline anchor count ${countOf(code, NLINE_ANCHOR)}`); process.exit(1); }
if (countOf(code, CARD_ANCHOR) !== 1) { console.error(`ABORT: card anchor count ${countOf(code, CARD_ANCHOR)}`); process.exit(1); }

code = code.replace(NLINE_ANCHOR, NLINE_ANCHOR + VENUE_BLOCK);
code = code.replace(CARD_ANCHOR, CARD_REPLACE);

if (!code.includes('const _venueLine =') || countOf(code, '_venueLine') < 2) { console.error('ABORT: post-edit verify failed'); process.exit(1); }
node.parameters.jsCode = code;

if (process.env.DRY_RUN) {
  const i = code.indexOf('const _vcfg =');
  console.log('DRY_RUN preview:\n' + code.slice(i - 20, i + 900));
  process.exit(0);
}
await n8n('PUT', ID, {
  name: wf.name, nodes: wf.nodes, connections: wf.connections,
  settings: wf.settings || {}, staticData: wf.staticData ?? null,
});
console.log('PUT ok — voice summary now includes address + parking.');
