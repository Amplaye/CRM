#!/usr/bin/env node
// Seed the commercial-info module's KB articles for a tenant from a markdown file.
// Generic: the content lives in DATA, not code — point it at any tenant + md file.
// Parses blocks of the form "## Articolo N — Titolo: `Title`" and upserts each as a
// knowledge_articles row (category 'commerciale', status 'published'). Idempotent:
// deletes the tenant's existing commerciale articles first, then re-inserts.
//
//   node scripts/seed/seed-commerciale.mjs <tenant_id> [path/to/seed.md]
//
// Cliente 1 (Oraz): node scripts/seed/seed-commerciale.mjs 93eebe9c-8af5-4ca5-a315-3376ef4976e5
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const SB = get('NEXT_PUBLIC_SUPABASE_URL');
const KEY = get('SUPABASE_SERVICE_ROLE_KEY');

const tenant = process.argv[2];
if (!tenant) { console.error('usage: node seed-commerciale.mjs <tenant_id> [md]'); process.exit(1); }
const mdPath = process.argv[3] || new URL('./commerciale-cliente1.md', import.meta.url);
const md = readFileSync(mdPath, 'utf8');

// Split into (title, body) blocks; body runs to the next "---" horizontal rule.
const parts = md.split(/^## Articolo \d+ — Titolo: `([^`]+)`\s*$/m);
const arts = [];
for (let i = 1; i < parts.length; i += 2) {
  const title = parts[i].trim();
  const body = parts[i + 1].split(/^---\s*$/m)[0].replace(/^\n+/, '').replace(/\n+$/, '');
  arts.push({ title, content: body });
}
if (!arts.length) { console.error('No "## Articolo N — Titolo: `...`" blocks found'); process.exit(1); }

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
async function sb(method, path, body, prefer) {
  const r = await fetch(SB + '/rest/v1/' + path, { method, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

// Idempotent reset of this tenant's commerciale articles.
await sb('DELETE', `knowledge_articles?tenant_id=eq.${tenant}&category=eq.commerciale`);
const rows = arts.map((a, i) => ({
  tenant_id: tenant, title: a.title, content: a.content, category: 'commerciale',
  status: 'published', risk_tags: [], version: 1, author_id: '', display_order: 900 + i,
}));
const inserted = await sb('POST', 'knowledge_articles', rows, 'return=representation');
console.log(`Seeded ${inserted.length} commerciale articles for ${tenant}:`);
for (const a of inserted) console.log('  +', a.title);
