#!/usr/bin/env node
// Deploy: on a MODIFY that turns a booking into a large group (requires_review),
// tell the CLIENT it's pending manual review — mirror the book large-group path.
// Today the modify path only pings the owner and sends the plain "modificada"
// card, so the client is never told it went to review.
// Safe: GET live -> backup -> verify anchor appears EXACTLY once (else ABORT)
// -> single targeted replace -> invariants -> PUT only {name,nodes,connections,settings,staticData}.
// Set DRY_RUN=1 to skip the PUT.
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = '166QnQsGHqXDpBxa';
const NODE = 'Book + Notify Owner';
const ANCHOR = `      await sendWhatsApp(this, input.from, modCard);`;

const REPLACEMENT = `      if (data.requires_review) {
        // [largegroup-modify-notice] Became a large group on modify -> tell the
        // CLIENT it's pending manual review (mirror the book large-group path).
        // The owner ping already went out above; the floor holds no tables now.
        const _reviewBody = (L.largeGroupReview || L.largeReview || '');
        const _reviewCard = _reviewBody + personasLine + fechaLine + horaLine + '\\n\\n' + (L.largeInstr || L.modifyCancelInstructions);
        await sendWhatsApp(this, input.from, _reviewCard);
      } else {
        await sendWhatsApp(this, input.from, modCard);
      }`;

const countOf = (s, sub) => s.split(sub).length - 1;

async function api(method, path, body) {
  const r = await fetch(`${BASE}/api/v1/workflows/${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} — ${await r.text()}`);
  return r.json();
}

const wf = await api('GET', ID);

// Backup
const stamp = process.env.STAMP || 'manual';
const backupPath = new URL(`../N8N/picnic/Chatbot_166.LIVE_backup_pre_largegroup-modify-notice_${stamp}.json`, import.meta.url);
writeFileSync(backupPath, JSON.stringify(wf, null, 2));
console.log('backup written:', backupPath.pathname);

const node = (wf.nodes || []).find((n) => n.name === NODE);
if (!node || typeof node.parameters?.jsCode !== 'string') {
  console.error('ABORT: target node or jsCode not found');
  process.exit(1);
}
let code = node.parameters.jsCode;

if (code.includes('[largegroup-modify-notice]')) {
  console.error('ABORT: largegroup-modify-notice block already present');
  process.exit(1);
}
const ac = countOf(code, ANCHOR);
if (ac !== 1) {
  console.error(`ABORT: anchor count is ${ac}, expected exactly 1`);
  process.exit(1);
}

code = code.replace(ANCHOR, REPLACEMENT);

// Post-replace invariants
const checks = {
  marker_now_1: countOf(code, '[largegroup-modify-notice]') === 1,
  // anchor line now lives inside the else branch -> still exactly 1
  anchor_still_1: countOf(code, ANCHOR) === 1,
  review_card_present: code.includes('const _reviewCard = _reviewBody'),
  // the large-group review i18n key the client message reuses must exist
  largegroupreview_intact: code.includes('largeGroupReview'),
  // don't clobber the owner notification that follows
  owner_modificada_intact: code.includes('RESERVA MODIFICADA'),
};
console.log('pre-PUT checks:', JSON.stringify(checks));
if (!Object.values(checks).every(Boolean)) {
  console.error('ABORT: post-replace invariants failed');
  process.exit(1);
}
node.parameters.jsCode = code;

// Write the patched jsCode out so it can be syntax-checked with `node --check`.
writeFileSync(new URL('../N8N/picnic/_patched_Book_Notify_Owner.js', import.meta.url), code);

if (process.env.DRY_RUN === '1') {
  console.log('DRY_RUN: skipping PUT (patched node written for node --check)');
  process.exit(0);
}

await api('PUT', ID, {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: wf.settings || {},
  staticData: wf.staticData || null,
});
console.log('PUT ok');
