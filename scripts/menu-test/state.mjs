// Check current state of Picnic menu (read-only).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local manually since dotenv defaults to .env
const env = readFileSync('/Users/amplaye/CRM/.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const PICNIC = '626547ff-bc44-4f35-8f42-0e97f1dcf0d5';
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const [{ data: cats, error: ce }, { data: items, error: ie }] = await Promise.all([
  supa.from('menu_categories').select('id, name, sort_order').eq('tenant_id', PICNIC).order('sort_order'),
  supa.from('menu_items').select('id, name, category_id, price, allergens, tags').eq('tenant_id', PICNIC),
]);
if (ce) throw ce;
if (ie) throw ie;

console.log(`Categories: ${cats.length}`);
for (const c of cats) console.log(`  - [${c.id.slice(0,8)}] ${c.name} (sort=${c.sort_order})`);
console.log(`Items: ${items.length}`);
const byCat = new Map();
for (const it of items) {
  const k = it.category_id || 'uncategorized';
  if (!byCat.has(k)) byCat.set(k, []);
  byCat.get(k).push(it);
}
for (const [k, list] of byCat) {
  const catName = cats.find((c) => c.id === k)?.name || 'UNCAT';
  console.log(`  [${catName}] ${list.length} items`);
}
