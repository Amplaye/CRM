// Multi-menu import test for Picnic tenant.
//
// For each test source: download (PDF/HTML) → call OpenAI Responses API
// (same path as src/lib/menu/extract.ts) → insert into Picnic's menu_*
// tables via service role (same logic as /api/menu/import-confirm).
//
// Purpose: prove that the menu-import pipeline handles different menu
// styles (trattoria, pizzeria, ristorante gourmet, ecc.) end-to-end.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --- env -------------------------------------------------------------
const env = readFileSync('/Users/amplaye/CRM/.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const PICNIC_TENANT_ID = '626547ff-bc44-4f35-8f42-0e97f1dcf0d5';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY missing');

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// --- prompts (mirrored from src/lib/menu/extract.ts) -----------------
const SYSTEM_PROMPT = `You are a menu-extraction assistant for an Italian restaurant CRM.

Your job is to read a restaurant menu (image, PDF or text) and output a STRICT JSON
object describing it. Follow these rules without exception:

1. Output VALID JSON only. No prose, no markdown fences, no comments.
2. Schema (TypeScript):
   {
     "categories": [
       {
         "name": string,            // e.g. "Antipasti", "Primi", "Pizze", "Dolci", "Bevande"
         "items": [
           {
             "name": string,         // dish name as it appears
             "description": string,  // ingredients / short description, "" if absent
             "price": number | null, // in the menu's currency, e.g. 12.5; null if no price shown
             "currency": string,     // "EUR" by default; "USD" if dollars, "GBP" if pounds
             "allergens": string[],  // lowercase tokens from this fixed list ONLY:
                                     // glutine, latticini, uova, pesce, crostacei, frutta_secca,
                                     // arachidi, soia, sedano, senape, sesamo, solfiti, lupini, molluschi
             "tags": string[]        // ONLY from this fixed list: vegano, vegetariano, piccante, consigliato
           }
         ]
       }
     ],
     "uncategorized": [ /* same item shape, for items found without a clear category */ ],
     "raw_notes": string             // optional, very short note about confidence/skipped sections
   }
3. NEVER invent prices, allergens, or tags that are not visibly stated or universally
   true (e.g. "carbonara" → eggs/dairy yes; "pizza margherita" → dairy yes; but do not
   guess "piccante" unless menu marks it).
4. Keep category names short and capitalized. Translate obvious foreign categories
   to Italian when the menu is in Italian; otherwise keep the original language.
5. If the file is not a menu, return {"categories":[],"uncategorized":[],"raw_notes":"not a menu"}.
6. Decimal separator: always use "." (12.50, never "12,50") in the JSON.`;

const USER_PROMPT = `Extract this menu as STRICT JSON following the schema in the system prompt.
Return ONLY the JSON object — no prose, no markdown, no explanation.`;

const ALLOWED_ALLERGENS = new Set([
  'glutine','latticini','uova','pesce','crostacei','frutta_secca',
  'arachidi','soia','sedano','senape','sesamo','solfiti','lupini','molluschi',
]);
const ALLOWED_TAGS = new Set(['vegano', 'vegetariano', 'piccante', 'consigliato']);

// --- extraction helpers ----------------------------------------------
async function callResponses(content) {
  const payload = {
    model: 'gpt-4o',
    max_output_tokens: 8000,
    temperature: 0,
    instructions: SYSTEM_PROMPT,
    input: [{ role: 'user', content }],
  };
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`openai ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = await res.json();
  if (typeof json.output_text === 'string' && json.output_text.length > 0) return json.output_text;
  const parts = [];
  for (const out of json.output || []) {
    for (const block of out.content || []) {
      if (typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('');
}

function parseExtraction(raw) {
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return normalize(JSON.parse(s));
}

function normalize(parsed) {
  const obj = parsed || {};
  const cats = Array.isArray(obj.categories) ? obj.categories : [];
  const uncat = Array.isArray(obj.uncategorized) ? obj.uncategorized : [];
  return {
    categories: cats.map(normCat),
    uncategorized: uncat.map(normItem),
    raw_notes: typeof obj.raw_notes === 'string' ? obj.raw_notes : undefined,
  };
}
function normCat(raw) {
  const o = raw || {};
  return {
    name: (typeof o.name === 'string' ? o.name : 'Senza nome').slice(0, 80).trim(),
    items: (Array.isArray(o.items) ? o.items : []).map(normItem),
  };
}
function normItem(raw) {
  const o = raw || {};
  let price = null;
  if (typeof o.price === 'number' && Number.isFinite(o.price)) price = o.price;
  else if (typeof o.price === 'string') {
    const n = Number(o.price.replace(',', '.'));
    if (Number.isFinite(n)) price = n;
  }
  const currency = typeof o.currency === 'string' && o.currency.length === 3 ? o.currency.toUpperCase() : 'EUR';
  const allergens = Array.isArray(o.allergens)
    ? [...new Set(o.allergens.filter((x) => typeof x === 'string').map((x) => x.toLowerCase().trim()).filter((x) => ALLOWED_ALLERGENS.has(x)))]
    : [];
  const tags = Array.isArray(o.tags)
    ? [...new Set(o.tags.filter((x) => typeof x === 'string').map((x) => x.toLowerCase().trim()).filter((x) => ALLOWED_TAGS.has(x)))]
    : [];
  return {
    name: (typeof o.name === 'string' ? o.name : '').slice(0, 120).trim(),
    description: (typeof o.description === 'string' ? o.description : '').slice(0, 600).trim(),
    price,
    currency,
    allergens,
    tags,
  };
}

async function downloadBinary(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType: ct };
}

async function extractFromUrl(url) {
  const { buf, contentType } = await downloadBinary(url);
  let mediaType;
  if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) mediaType = 'application/pdf';
  else if (contentType.includes('jpeg') || contentType.includes('jpg')) mediaType = 'image/jpeg';
  else if (contentType.includes('png')) mediaType = 'image/png';
  else if (contentType.includes('webp')) mediaType = 'image/webp';
  else throw new Error(`unsupported content-type "${contentType}" for ${url}`);

  const dataUrl = `data:${mediaType};base64,${buf.toString('base64')}`;
  const block = mediaType === 'application/pdf'
    ? { type: 'input_file', filename: 'menu.pdf', file_data: dataUrl }
    : { type: 'input_image', image_url: dataUrl };

  const raw = await callResponses([block, { type: 'input_text', text: USER_PROMPT }]);
  return { extracted: parseExtraction(raw), bytes: buf.length, mediaType };
}

// --- save (mirror of /api/menu/import-confirm) -----------------------
async function saveExtracted(tenantId, extracted, sourceLabel) {
  const { data: existingCats, error: ce } = await supa
    .from('menu_categories')
    .select('id, name, sort_order')
    .eq('tenant_id', tenantId);
  if (ce) throw ce;

  const nameToId = new Map();
  let maxOrder = 0;
  for (const c of existingCats || []) {
    nameToId.set(c.name.toLowerCase().trim(), c.id);
    if (c.sort_order > maxOrder) maxOrder = c.sort_order;
  }

  let catsCreated = 0;
  let itemsCreated = 0;

  for (const cat of extracted.categories) {
    const key = cat.name.toLowerCase().trim();
    let catId = nameToId.get(key);
    if (!catId) {
      maxOrder += 1;
      const { data: ins, error } = await supa
        .from('menu_categories')
        .insert({ tenant_id: tenantId, name: cat.name, sort_order: maxOrder })
        .select('id').single();
      if (error) throw error;
      catId = ins.id;
      nameToId.set(key, catId);
      catsCreated += 1;
    }
    const rows = cat.items
      .filter((it) => it.name.trim().length > 0)
      .map((it, idx) => ({
        tenant_id: tenantId,
        category_id: catId,
        name: it.name,
        description: it.description,
        price: it.price,
        currency: it.currency || 'EUR',
        allergens: it.allergens,
        tags: it.tags,
        available: true,
        sort_order: idx,
      }));
    if (rows.length > 0) {
      const { error } = await supa.from('menu_items').insert(rows);
      if (error) throw error;
      itemsCreated += rows.length;
    }
  }

  const uncat = extracted.uncategorized
    .filter((it) => it.name.trim().length > 0)
    .map((it, idx) => ({
      tenant_id: tenantId,
      category_id: null,
      name: it.name,
      description: it.description,
      price: it.price,
      currency: it.currency || 'EUR',
      allergens: it.allergens,
      tags: it.tags,
      available: true,
      sort_order: idx,
    }));
  if (uncat.length > 0) {
    const { error } = await supa.from('menu_items').insert(uncat);
    if (error) throw error;
    itemsCreated += uncat.length;
  }

  return { catsCreated, itemsCreated, sourceLabel };
}

// --- test sources ----------------------------------------------------
// Three intentionally-different menu styles, all real public restaurant
// PDFs found via Google. If any URL 404s we report it and move on.
const SOURCES = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((url, i) => ({ label: `cli-${i+1}`, url }))
  : [
      // Will be overridden by --url args; keeping placeholders here for
      // visibility but the script is meant to be invoked with URLs.
    ];

if (SOURCES.length === 0) {
  console.error('Usage: node import.mjs <pdf_url_1> [<pdf_url_2> ...]');
  process.exit(2);
}

// --- main ------------------------------------------------------------
const results = [];
for (const src of SOURCES) {
  console.log(`\n=== ${src.label} :: ${src.url}`);
  const t0 = Date.now();
  try {
    const { extracted, bytes, mediaType } = await extractFromUrl(src.url);
    const totalItems =
      extracted.categories.reduce((s, c) => s + c.items.length, 0) +
      extracted.uncategorized.length;
    console.log(
      `  ↳ extracted: ${extracted.categories.length} cat, ${totalItems} items, ` +
      `${(bytes/1024).toFixed(0)} KB ${mediaType}, ${((Date.now()-t0)/1000).toFixed(1)}s`
    );
    if (extracted.raw_notes) console.log(`  ↳ notes: ${extracted.raw_notes}`);
    for (const c of extracted.categories) {
      console.log(`     · ${c.name} (${c.items.length})`);
    }

    const saveRes = await saveExtracted(PICNIC_TENANT_ID, extracted, src.label);
    console.log(`  ↳ saved: +${saveRes.catsCreated} cats, +${saveRes.itemsCreated} items`);
    results.push({ ok: true, label: src.label, url: src.url, totalItems, ...saveRes });
  } catch (e) {
    console.log(`  ✗ FAILED: ${e.message}`);
    results.push({ ok: false, label: src.label, url: src.url, error: e.message });
  }
}

// final state
const [{ data: catsFinal }, { data: itemsFinal }] = await Promise.all([
  supa.from('menu_categories').select('id, name').eq('tenant_id', PICNIC_TENANT_ID),
  supa.from('menu_items').select('id, allergens, tags, price').eq('tenant_id', PICNIC_TENANT_ID),
]);

console.log('\n=== Summary');
for (const r of results) {
  const tag = r.ok ? 'OK' : 'FAIL';
  const info = r.ok ? `${r.catsCreated} cats / ${r.itemsCreated} items (extracted ${r.totalItems})` : r.error;
  console.log(`  [${tag}] ${r.label} — ${info}`);
}
console.log(`\nFinal DB state for Picnic: ${catsFinal?.length || 0} categories, ${itemsFinal?.length || 0} items.`);
const withAllergens = (itemsFinal || []).filter((i) => i.allergens && i.allergens.length > 0).length;
const withTags = (itemsFinal || []).filter((i) => i.tags && i.tags.length > 0).length;
const withPrice = (itemsFinal || []).filter((i) => i.price != null).length;
console.log(`  · items with price: ${withPrice}/${itemsFinal?.length || 0}`);
console.log(`  · items with allergens: ${withAllergens}/${itemsFinal?.length || 0}`);
console.log(`  · items with tags: ${withTags}/${itemsFinal?.length || 0}`);
