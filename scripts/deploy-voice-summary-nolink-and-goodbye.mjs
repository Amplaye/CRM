#!/usr/bin/env node
// Two fixes in the voice Book Logic:
//  (#2) Drop the long Google-Maps URL from the summary — keep just the address.
//  (#3) The spoken success line now ends with a goodbye (and no detail re-listing),
//       so the bot actually says bye after confirming instead of going silent.
// Line-based edits (preserve indentation; match by unique ASCII marker).
// Safe: GET -> backup -> per-edit count check -> PUT. DRY_RUN=1 skips PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = 'KLRgoVjOp9iZfr2R';
const NODE = 'Book Logic';

// Each rule: a predicate to find the target line, and the new RHS (from
// 'voiceConfirmedTts:' / 'const _aline =' onward) — indentation is preserved.
const TTS = {
  'Reserva confirmada para': `voiceConfirmedTts: function(d){ return 'Reserva confirmada. Te he enviado el resumen por WhatsApp. ¡Gracias y hasta pronto!'; },`,
  'Prenotazione confermata per': `voiceConfirmedTts: function(d){ return 'Prenotazione confermata. Ti ho inviato il riepilogo su WhatsApp. Grazie e a presto!'; },`,
  'Booking confirmed for': `voiceConfirmedTts: function(d){ return 'Booking confirmed. I have sent you the summary by WhatsApp. Thank you and see you soon!'; },`,
  'Reservierung best': `voiceConfirmedTts: function(d){ return 'Reservierung best\\u00e4tigt. Ich habe dir die Zusammenfassung per WhatsApp geschickt. Danke und bis bald!'; },`,
};

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
writeFileSync(new URL(`../N8N/Voice_${ID}.LIVE_backup_pre_nolink-goodbye_${process.env.STAMP || 'manual'}.json`, import.meta.url), JSON.stringify(wf, null, 2));
const node = (wf.nodes || []).find((n) => n.name === NODE);
let code = node?.parameters?.jsCode;
if (typeof code !== 'string') { console.error('ABORT: node/jsCode not found'); process.exit(1); }

const hits = { tts: 0, aline: 0 };
const lines = code.split('\n').map((line) => {
  if (line.includes('voiceConfirmedTts') && line.includes('function(d)')) {
    for (const [marker, repl] of Object.entries(TTS)) {
      if (line.includes(marker)) { hits.tts++; return line.replace(/voiceConfirmedTts:.*$/, repl); }
    }
  }
  if (line.includes('const _aline =')) {
    hits.aline++;
    return line.replace(/const _aline =.*$/, `const _aline = _addr ? '\\n' + _vL.addr + ' ' + _addr : '';`);
  }
  return line;
});
if (hits.tts !== 4) { console.error(`ABORT: expected 4 voiceConfirmedTts lines, matched ${hits.tts}`); process.exit(1); }
if (hits.aline !== 1) { console.error(`ABORT: expected 1 _aline, matched ${hits.aline}`); process.exit(1); }
code = lines.join('\n');
if (code.includes('maps/search')) { console.error('ABORT: maps link still present'); process.exit(1); }
node.parameters.jsCode = code;

if (process.env.DRY_RUN) { console.log(`DRY_RUN ok: ${hits.tts} TTS + ${hits.aline} aline edited, maps link removed.`); process.exit(0); }
await n8n('PUT', ID, { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {}, staticData: wf.staticData ?? null });
console.log('PUT ok — summary has no maps link; spoken confirmation ends with a goodbye.');
