#!/usr/bin/env node
// Probe live Picnic chatbot workflow state. Read-only. Prints short booleans/counts.
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = get('N8N_BASE_URL');
const KEY = get('N8N_API_KEY');
const ID = '166QnQsGHqXDpBxa';
const ANCHOR = 'const isArrivalCmd = !!_msgL && _arrivalRegex.test(_msgL);';
const NODE = 'Fetch History + Check Availability';

const r = await fetch(`${BASE}/api/v1/workflows/${ID}`, { headers: { 'X-N8N-API-KEY': KEY } });
if (!r.ok) { console.error('HTTP', r.status); process.exit(1); }
const wf = await r.json();

const countOf = (s, sub) => s.split(sub).length - 1;
const node = (wf.nodes || []).find((n) => n.name === NODE);
const code = node?.parameters?.jsCode || '';

console.log(JSON.stringify({
  name: wf.name,
  active: wf.active,
  nodeCount: (wf.nodes || []).length,
  fetchNode_found: !!node,
  anchor_count: countOf(code, ANCHOR),
  timeShift_marker: code.includes('[Picnic late-arrival time-shift]'),
  retraso_minutos_count: countOf(code, 'retraso_minutos'),
  noshow_warning_responded_present: code.includes('noshow_warning_responded'),
  arrivalRegex_present: code.includes('_arrivalRegex'),
}, null, 2));
