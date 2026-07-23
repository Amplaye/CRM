import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { assertAiSecret } from '@/lib/ai-auth';
import { matchCollectionKind, KIND_TO_TAG } from '@/lib/menu/collection-match';
import type { CollectionKind } from '@/lib/types';

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

const PUBLIC_BASE = 'https://app.baliflowagency.com';

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

// Multilingual food-category words → substrings to match against the tenant's
// REAL category names (which may be in another language, e.g. Oraz uses English
// "Dessert"). Without this, "¿qué postres tenéis?" / "che dolci avete?" miss the
// "Dessert" category and fall back to the menu link. Keys are normalized words
// found in the customer's query; values are normalized substrings that, if any
// appears in a category name, resolve to that category.
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  postre: ['dessert', 'postre', 'dolc', 'nachtisch'],
  postres: ['dessert', 'postre', 'dolc', 'nachtisch'],
  dolce: ['dessert', 'dolc', 'postre'],
  dolci: ['dessert', 'dolc', 'postre'],
  dessert: ['dessert', 'dolc', 'postre'],
  desserts: ['dessert', 'dolc', 'postre'],
  nachtisch: ['dessert', 'dolc', 'postre'],
  entrante: ['appetizer', 'starter', 'entrante', 'antipast'],
  entrantes: ['appetizer', 'starter', 'entrante', 'antipast'],
  antipasto: ['appetizer', 'starter', 'antipast'],
  antipasti: ['appetizer', 'starter', 'antipast'],
  starter: ['appetizer', 'starter', 'antipast'],
  starters: ['appetizer', 'starter', 'antipast'],
  appetizer: ['appetizer', 'starter', 'antipast'],
  ensalada: ['salad', 'ensalada', 'insalat'],
  ensaladas: ['salad', 'ensalada', 'insalat'],
  insalata: ['salad', 'insalat'],
  salad: ['salad', 'ensalada', 'insalat'],
  sopa: ['soup', 'sopa', 'zupp'],
  sopas: ['soup', 'sopa', 'zupp'],
  zuppa: ['soup', 'zupp'],
  soup: ['soup', 'sopa', 'zupp'],
  bebida: ['drink', 'beverage', 'bebida', 'bevand'],
  bebidas: ['drink', 'beverage', 'bebida', 'bevand'],
  bevanda: ['drink', 'beverage', 'bevand'],
  bevande: ['drink', 'beverage', 'bevand'],
  drink: ['drink', 'beverage', 'bevand'],
  drinks: ['drink', 'beverage', 'bevand'],
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
    const collectionRaw = (searchParams.get('collection') || '').trim();

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

    const [
      { data: catsRaw },
      { data: itemsRaw, error: itemsErr },
      { data: collsRaw },
      { data: linksRaw },
    ] = await Promise.all([
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
      supabase
        .from('menu_collections')
        .select('id,name,kind,sort_order')
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('menu_collection_items')
        .select('collection_id,item_id')
        .eq('tenant_id', tenantId),
    ]);

    if (itemsErr) throw itemsErr;

    const cats = (catsRaw || []) as CategoryRow[];
    const items = (itemsRaw || []) as ItemRow[];
    const colls = (collsRaw || []) as { id: string; name: string; kind: CollectionKind | null; sort_order: number }[];
    const links = (linksRaw || []) as { collection_id: string; item_id: string }[];
    const catName = new Map<string, string>();
    for (const c of cats) catName.set(c.id, c.name);

    // collectionId → available dishes (links resolved against the available set).
    const itemsById = new Map(items.map((it) => [it.id, it]));
    const itemsByColl = new Map<string, ItemRow[]>();
    for (const l of links) {
      const dish = itemsById.get(l.item_id);
      if (!dish) continue;
      const list = itemsByColl.get(l.collection_id);
      if (list) list.push(dish);
      else itemsByColl.set(l.collection_id, [dish]);
    }

    // Resolve a target collection from an explicit `collection=` param or a
    // natural-language query. Returns the dishes (or null if no collection
    // matched here). Shared by the explicit branch and the dish-path coercion.
    const resolveCollection = (raw: string): { kind: CollectionKind | null; name: string; items: ItemRow[] } | null => {
      const wantKind = matchCollectionKind(raw);
      let col = wantKind ? colls.find((c) => c.kind === wantKind) : undefined;
      if (!col) {
        // custom collection asked by name (forgiving match like the category path)
        const w = norm(raw);
        col = colls.find((c) => norm(c.name) === w) || colls.find((c) => norm(c.name).includes(w) || w.includes(norm(c.name)));
      }
      if (col) return { kind: col.kind, name: col.name, items: itemsByColl.get(col.id) || [] };
      // No collection row, but the ask maps to a kind that has a tag analogue:
      // fall back to dishes carrying that badge (owner tagged but built no
      // collection). menu_del_giorno has no tag → no fallback.
      if (wantKind) {
        const tag = KIND_TO_TAG[wantKind];
        if (tag) {
          const tagged = items.filter((it) => (it.tags || []).map(norm).includes(tag));
          if (tagged.length > 0) return { kind: wantKind, name: tag, items: tagged };
        }
        return { kind: wantKind, name: raw, items: [] }; // matched intent, nothing to show
      }
      return null;
    };

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
    if (!dishRaw && !categoryRaw && !collectionRaw) {
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

    // Shapes a collection-mode response (its dishes, with each dish's category).
    const collectionResponse = (
      resolved: { kind: CollectionKind | null; name: string; items: ItemRow[] },
      query?: string
    ) => {
      const LIMIT = 8;
      const shaped = resolved.items
        .slice(0, LIMIT)
        .map((it) => shapeItem(it, it.category_id ? catName.get(it.category_id) || null : null));
      return NextResponse.json({
        success: true,
        mode: 'collection',
        ...(query ? { query } : {}),
        collection_kind: resolved.kind,
        found: shaped.length > 0,
        items: shaped,
        truncated: resolved.items.length > LIMIT,
        // When nothing matched, give the agent the categories to offer instead.
        ...(shaped.length === 0
          ? { categories: cats.map((c) => c.name), message: 'No tengo platos en esa selección ahora mismo.' }
          : {}),
        menu_url: menuUrl,
      });
    };

    // ---- Mode 2.5: explicit collection ("collection=consigliati") -----------
    if (collectionRaw && !dishRaw) {
      const resolved = resolveCollection(collectionRaw);
      if (resolved) return collectionResponse(resolved);
      // Unknown collection name → offer categories.
      return NextResponse.json({
        success: true,
        mode: 'collection',
        found: false,
        categories: cats.map((c) => c.name),
        menu_url: menuUrl,
        message: 'No encuentro esa selección del menú.',
      });
    }

    // ---- Mode 3: dish lookup (the main path) --------------------------------
    const q = norm(dishRaw);

    // Drop filler words so a whole sentence ("¿cuánto cuesta la pizza ortolana?")
    // narrows to the meaningful tokens ("pizza", "ortolana"). The chatbot passes
    // the raw question here, so this is what makes phrase queries work.
    const STOPWORDS = new Set([
      'el','la','los','las','un','una','unos','unas','de','del','al','y','o','con','sin','para','por','que','qué',
      'cuanto','cuánto','cuesta','cuestan','precio','precios','vale','valen','tiene','tienen','teneis','tenéis','hay','me','mi','su',
      'il','lo','gli','le','dei','degli','delle','e','con','senza','quanto','costa','costano','prezzo','avete','avete','che','mi','un',
      'the','a','an','of','how','much','do','you','have','is','are','price','cost','with','without','some','any',
      'piatto','piatti','plato','platos','dish','dishes','menu','menú','carta','comida','cibo',
    ]);
    // Strip punctuation glued to tokens ("ortolana?" → "ortolana", "ortolana." )
    // so a token still matches the bare dish name. norm() folds case/accents but
    // leaves punctuation, so a question mark would otherwise break name matching.
    const sigTokens = q
      .split(/\s+/)
      .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

    const catMatch = (cn: string, tok: string) =>
      cn === tok || (tok.length >= 4 && (cn.startsWith(tok.slice(0, -1)) || tok.startsWith(cn.slice(0, -1))));

    // Diet/allergen synonyms: match as a SUBSTRING of the question, not just an
    // exact query. "avete piatti senza glutine" must trigger the gluten-free
    // path, not a token match that (wrongly) returns dishes that DO contain
    // gluten. Longest key first so "sin lactosa" beats a partial "sin". This is
    // resolved BEFORE category coercion so "pizzas sin gluten" filters by diet.
    const synKey = Object.keys(QUERY_SYNONYMS)
      .sort((a, b) => b.length - a.length)
      .find((k) => q.includes(k));
    const syn = synKey ? QUERY_SYNONYMS[synKey] : undefined;

    // Does a meaningful token point at a SPECIFIC dish by name? ("ortolana",
    // "tiramisu"). If so, that wins over a category coercion — "cuánto cuesta la
    // pizza ortolana" should return the Ortolana dish, not the whole Pizze list.
    // We ignore tokens that merely equal a category name for this check.
    const catTokens = new Set(cats.flatMap((c) => norm(c.name).split(/\s+/)));
    const dishNameHit = items.some((it) => {
      const n = norm(it.name);
      return sigTokens.some((t) => !catTokens.has(t) && (n === t || n.split(/\s+/).includes(t)));
    });

    // Collection intent ("quali piatti consigliate?", "menu del giorno",
    // "novedades"). Resolved AFTER a specific dish name and a diet filter (so
    // "tiramisù" or "sin gluten" still win) but BEFORE category coercion (so
    // "consigliati" isn't mistaken for a category). Falls back to tagged dishes
    // when the owner tagged but built no collection.
    if (!dishNameHit && !syn) {
      const wantKind = matchCollectionKind(dishRaw);
      if (wantKind) {
        const resolved = resolveCollection(dishRaw);
        if (resolved) return collectionResponse(resolved, dishRaw);
      }
    }

    // If a meaningful token names a category ("pizze", "dolci", "bevande") AND no
    // specific dish or diet filter was named, treat it as a category request.
    // Also resolve cross-language category words (e.g. ES "postres" → EN "Dessert")
    // via CATEGORY_SYNONYMS, so a tenant whose categories are in another language
    // still answers "¿qué postres tenéis?" instead of deflecting to the menu link.
    const synTargets = (dishNameHit || syn)
      ? []
      : Array.from(new Set([q, ...sigTokens].flatMap((t) => CATEGORY_SYNONYMS[t] || [])));
    const asCat = (dishNameHit || syn) ? undefined : cats.find((c) => {
      const n = norm(c.name);
      if (catMatch(n, q)) return true;
      if (synTargets.some((s) => n.includes(s))) return true;
      return sigTokens.some((t) => catMatch(n, t));
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

    let matches: ItemRow[];
    if (syn?.allergenAbsent) {
      // "senza glutine" etc → items that do NOT list that allergen.
      const allergen = syn.allergenAbsent;
      matches = items.filter((it) => !(it.allergens || []).map(norm).includes(allergen));
    } else if (syn?.tag) {
      const tag = syn.tag;
      matches = items.filter((it) => (it.tags || []).map(norm).includes(tag));
    } else {
      // Match meaningful tokens against name + description + allergens + tags.
      // Prefer items containing ALL tokens; if none, fall back to ANY token and
      // rank by how many matched — so "pizza ortolana" still finds "Ortolana"
      // even though no item contains the filler-laden full phrase.
      const hay = (it: ItemRow) =>
        norm(it.name) + ' ' + norm(it.description) + ' ' + (it.allergens || []).map(norm).join(' ') + ' ' + (it.tags || []).map(norm).join(' ');
      const score = (it: ItemRow) => {
        const h = hay(it);
        if (sigTokens.length === 0) return 0;
        return sigTokens.reduce((n, t) => n + (h.includes(t) ? 1 : 0), 0);
      };
      const all = items.filter((it) => sigTokens.length > 0 && sigTokens.every((t) => hay(it).includes(t)));
      const any = items.filter((it) => score(it) > 0);
      matches = all.length > 0 ? all : any;
      // Rank: exact name first, then name-substring, then token coverage, then menu order.
      matches.sort((a, b) => {
        const nameRank = (it: ItemRow) =>
          norm(it.name) === q ? 0 : sigTokens.some((t) => norm(it.name) === t) ? 1 : norm(it.name).includes(q) ? 2 : 3;
        const ar = nameRank(a), br = nameRank(b);
        if (ar !== br) return ar - br;
        return score(b) - score(a);
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
