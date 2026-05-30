import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';

// Live menu lookup for the AI agents (WhatsApp bot + voice). Reads the
// `menu_categories` / `menu_items` tables directly — NOT the knowledge base.
//
// Design (decided with the user, "el cameriere esperto"):
//   - The agent must NEVER recite the whole menu. So a bare call returns only
//     the CATEGORY NAMES + the public menu link, for "what do you have?".
//   - When the customer asks about a specific dish (`dish=`) we return only the
//     matching items (name, price, allergens, tags) — partial, accent- and
//     case-insensitive match on name / description / allergen / tag.
//   - `category=` returns the items of one category.
// Only `available = true` items are ever returned (same rule as /m/[slug]).
//
// Localization is intentionally left to the agent: we return raw data + neutral
// labels, the assistant phrases it in the customer's language (same contract as
// /api/ai/restaurant-info).

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ItemRow = {
  id: string;
  category_id: string | null;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  allergens: string[];
  tags: string[];
  available: boolean;
  sort_order: number;
};

type CategoryRow = { id: string; name: string; sort_order: number };

const PUBLIC_BASE = 'https://crm.baliflowagency.com';

// Fold accents + lowercase so "Margherita", "margherita" and a customer's
// "marguerita"-ish input all compare on the same footing.
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// A few common allergen/diet words customers use, mapped to the canonical
// tokens stored on items. Lets "senza glutine" / "gluten free" / "vegano"
// queries hit the right dishes without the agent knowing our token set.
const QUERY_SYNONYMS: Record<string, { allergenAbsent?: string; tag?: string }> = {
  'sin gluten': { allergenAbsent: 'glutine' },
  'senza glutine': { allergenAbsent: 'glutine' },
  'gluten free': { allergenAbsent: 'glutine' },
  'gluten-free': { allergenAbsent: 'glutine' },
  celiaco: { allergenAbsent: 'glutine' },
  'sin lactosa': { allergenAbsent: 'latticini' },
  'senza lattosio': { allergenAbsent: 'latticini' },
  vegano: { tag: 'vegano' },
  vegan: { tag: 'vegano' },
  vegetariano: { tag: 'vegetariano' },
  vegetarian: { tag: 'vegetariano' },
  picante: { tag: 'piccante' },
  piccante: { tag: 'piccante' },
  spicy: { tag: 'piccante' },
};

function shapeItem(it: ItemRow, catName: string | null) {
  return {
    name: it.name,
    description: it.description || undefined,
    price: it.price,
    currency: it.currency || 'EUR',
    allergens: it.allergens || [],
    tags: it.tags || [],
    category: catName || undefined,
  };
}

export async function GET(request: Request) {
  const unauth = assertAiSecret(request);
  if (unauth) return unauth;

  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenant_id');
    const dishRaw = (searchParams.get('dish') || searchParams.get('q') || '').trim();
    const categoryRaw = (searchParams.get('category') || '').trim();

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'Missing tenant_id' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Tenant + public slug (for the "what do you have" link).
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('slug, status')
      .eq('id', tenantId)
      .maybeSingle();

    const menuUrl = tenantRow?.slug ? `${PUBLIC_BASE}/m/${tenantRow.slug}` : null;

    const [{ data: catsRaw }, { data: itemsRaw, error: itemsErr }] = await Promise.all([
      supabase
        .from('menu_categories')
        .select('id,name,sort_order')
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('menu_items')
        .select(
          'id,category_id,name,description,price,currency,allergens,tags,available,sort_order'
        )
        .eq('tenant_id', tenantId)
        .eq('available', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

    if (itemsErr) throw itemsErr;

    const cats = (catsRaw || []) as CategoryRow[];
    const items = (itemsRaw || []) as ItemRow[];
    const catName = new Map<string, string>();
    for (const c of cats) catName.set(c.id, c.name);

    // No menu at all for this tenant.
    if (items.length === 0 && cats.length === 0) {
      return NextResponse.json({
        success: true,
        mode: 'empty',
        found: false,
        message: 'No tengo el menú cargado todavía. ¿Quieres que te pase con el responsable?',
        menu_url: menuUrl,
      });
    }

    // ---- Mode 1: category names only ("¿qué tenéis?" / "cosa avete?") --------
    // Bare call, or an explicit request for the category list. The agent gets
    // ONLY the category names + the link; it must invite the customer to pick a
    // category or ask about a dish, never list every item.
    if (!dishRaw && !categoryRaw) {
      return NextResponse.json({
        success: true,
        mode: 'categories',
        found: cats.length > 0,
        categories: cats.map((c) => c.name),
        item_count: items.length,
        menu_url: menuUrl,
        note: 'Offer these categories or ask which dish the guest wants. Do NOT list every dish; share menu_url for the full menu.',
      });
    }

    // ---- Mode 2: a specific category ----------------------------------------
    if (categoryRaw && !dishRaw) {
      const want = norm(categoryRaw);
      const cat = cats.find((c) => norm(c.name) === want) || cats.find((c) => norm(c.name).includes(want) || want.includes(norm(c.name)));
      if (!cat) {
        return NextResponse.json({
          success: true,
          mode: 'category',
          found: false,
          categories: cats.map((c) => c.name),
          menu_url: menuUrl,
          message: 'No encuentro esa sección del menú.',
        });
      }
      const inCat = items.filter((it) => it.category_id === cat.id).map((it) => shapeItem(it, cat.name));
      return NextResponse.json({
        success: true,
        mode: 'category',
        found: inCat.length > 0,
        category: cat.name,
        items: inCat,
        menu_url: menuUrl,
      });
    }

    // ---- Mode 3: dish lookup (the main path) --------------------------------
    const q = norm(dishRaw);

    // If `dish` actually names a category ("pizze", "dolci", "bevande"), treat
    // it as a category request — robust to the agent picking the wrong param,
    // and to "¿qué pizzas tenéis?" arriving as dish=pizzas. Singular/plural
    // tolerant via mutual prefix (pizza↔pizze, dolce↔dolci).
    const asCat = cats.find((c) => {
      const n = norm(c.name);
      return n === q || (q.length >= 4 && (n.startsWith(q.slice(0, -1)) || q.startsWith(n.slice(0, -1))));
    });
    if (asCat) {
      const inCat = items.filter((it) => it.category_id === asCat.id).map((it) => shapeItem(it, asCat.name));
      if (inCat.length > 0) {
        return NextResponse.json({
          success: true,
          mode: 'category',
          query: dishRaw,
          found: true,
          category: asCat.name,
          items: inCat,
          menu_url: menuUrl,
        });
      }
    }

    const syn = QUERY_SYNONYMS[q];

    let matches: ItemRow[];
    if (syn?.allergenAbsent) {
      // "senza glutine" etc → items that do NOT list that allergen.
      const allergen = syn.allergenAbsent;
      matches = items.filter((it) => !(it.allergens || []).map(norm).includes(allergen));
    } else if (syn?.tag) {
      const tag = syn.tag;
      matches = items.filter((it) => (it.tags || []).map(norm).includes(tag));
    } else {
      // Token-based partial match against name + description + allergens + tags.
      const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
      const hay = (it: ItemRow) =>
        norm(it.name) + ' ' + norm(it.description) + ' ' + (it.allergens || []).map(norm).join(' ') + ' ' + (it.tags || []).map(norm).join(' ');
      matches = items.filter((it) => {
        const h = hay(it);
        if (h.includes(q)) return true; // whole-phrase hit
        return tokens.length > 0 && tokens.every((t) => h.includes(t));
      });
      // Rank exact-name matches first, then by menu order.
      matches.sort((a, b) => {
        const ax = norm(a.name) === q ? 0 : norm(a.name).includes(q) ? 1 : 2;
        const bx = norm(b.name) === q ? 0 : norm(b.name).includes(q) ? 1 : 2;
        return ax - bx;
      });
    }

    // Cap to keep the agent from reading a long list aloud.
    const LIMIT = 8;
    const shaped = matches.slice(0, LIMIT).map((it) => shapeItem(it, it.category_id ? catName.get(it.category_id) || null : null));

    if (shaped.length === 0) {
      return NextResponse.json({
        success: true,
        mode: 'dish',
        query: dishRaw,
        found: false,
        categories: cats.map((c) => c.name),
        menu_url: menuUrl,
        message: 'No tengo ese plato en la carta. Puedo ofrecer otra cosa o pasar el menú completo.',
      });
    }

    return NextResponse.json({
      success: true,
      mode: 'dish',
      query: dishRaw,
      found: true,
      items: shaped,
      truncated: matches.length > LIMIT,
      menu_url: menuUrl,
    });
  } catch (err: any) {
    console.error('ai/menu error:', err);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
