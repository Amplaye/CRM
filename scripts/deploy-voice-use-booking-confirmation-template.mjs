#!/usr/bin/env node
// Deploy: the VOICE Book Logic node sends the post-booking WhatsApp summary as
// the `booking_reminder` template ("Ti ricordiamo… Rispondi SÌ/NO") because a
// voice-only caller has no open 24h window. That reads like a reminder, and its
// SÌ/NO buttons misroute to the chat bot. Swap it to the dedicated, button-less
// `booking_confirmation` template (same {{1}}–{{5}} mapping) so the guest gets a
// real confirmation summary.
//
// PRECONDITION: booking_confirmation must be APPROVED on the WABA (all langs) —
// the script checks this and ABORTS otherwise (sending an unapproved template
// fails at Meta). Safe: GET live -> backup -> verify single anchor -> replace
// -> PUT. Set DRY_RUN=1 to skip the PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const META_TOKEN = get('META_ACCESS_TOKEN');
const WABA_ID = get('META_WABA_ID');
const VER = get('META_GRAPH_VERSION') || 'v21.0';
const ID = 'KLRgoVjOp9iZfr2R';
const NODE = 'Book Logic';
const ANCHOR = `name: 'booking_reminder',`;
const REPLACEMENT = `name: 'booking_confirmation',`;
const countOf = (s, sub) => s.split(sub).length - 1;

// 1. Verify the new template is approved in all four languages.
const tplRes = await fetch(
  `https://graph.facebook.com/${VER}/${WABA_ID}/message_templates?name=booking_confirmation&limit=50&access_token=${META_TOKEN}`,
);
const tpl = await tplRes.json();
const byLang = Object.fromEntries((tpl.data || []).map((t) => [t.language, t.status]));
const need = ['es', 'it', 'en', 'de'];
const notApproved = need.filter((l) => byLang[l] !== 'APPROVED');
console.log('booking_confirmation status:', JSON.stringify(byLang));
if (notApproved.length) {
  console.error(`ABORT: not APPROVED yet for: ${notApproved.join(', ')} — re-run once Meta approves.`);
  process.exit(2);
}

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
  new URL(`../N8N/Voice_${ID}.LIVE_backup_pre_booking-confirmation-tpl_${stamp}.json`, import.meta.url),
  JSON.stringify(wf, null, 2),
);

const node = (wf.nodes || []).find((n) => n.name === NODE);
let code = node?.parameters?.jsCode;
if (typeof code !== 'string') { console.error('ABORT: node/jsCode not found'); process.exit(1); }
const n = countOf(code, ANCHOR);
if (n !== 1) { console.error(`ABORT: anchor found ${n} times (expected 1)`); process.exit(1); }
code = code.replace(ANCHOR, REPLACEMENT);
if (countOf(code, REPLACEMENT) !== 1) { console.error('ABORT: replacement verify failed'); process.exit(1); }
node.parameters.jsCode = code;

if (process.env.DRY_RUN) { console.log('DRY_RUN: verified, not writing.'); process.exit(0); }

await n8n('PUT', ID, {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
  staticData: wf.staticData ?? null,
});
console.log('PUT ok — voice flow now sends the booking_confirmation template.');
