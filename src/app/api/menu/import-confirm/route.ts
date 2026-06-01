import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeExtraction, type ExtractedMenu } from '@/lib/menu/extract';

// Persist a (possibly user-edited) extracted menu into menu_categories +
// menu_items for the given tenant. RLS enforces membership.
//
// mode (default 'replace'): uploading a menu means "this IS the menu" — a
// re-upload should REPLACE the current one, not pile duplicates on top (a
// second "Entrantes" merged into the first, every dish added again). So by
// default we wipe the tenant's existing categories + items first. Pass
// mode:'append' to keep the old additive behaviour (merge into same-named
// categories).

export const runtime = 'nodejs';

type Body = {
  tenant_id: string;
  extracted: ExtractedMenu;
  mode?: 'replace' | 'append';
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.tenant_id !== 'string' || !body.extracted) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Re-normalize on the server so the client cannot inject categories/tags
  // beyond the allow-list.
  const extracted = normalizeExtraction(body.extracted);
  const mode: 'replace' | 'append' = body.mode === 'append' ? 'append' : 'replace';

  // REPLACE mode (default): wipe the tenant's current menu first so a re-upload
  // doesn't duplicate. Delete items before categories (items reference
  // category_id). RLS scopes both deletes to tenants the user can manage.
  if (mode === 'replace') {
    const { error: delItemsErr } = await supabase
      .from('menu_items')
      .delete()
      .eq('tenant_id', body.tenant_id);
    if (delItemsErr) {
      return NextResponse.json(
        { error: 'Failed to clear existing items', details: delItemsErr.message },
        { status: 500 }
      );
    }
    const { error: delCatsErr } = await supabase
      .from('menu_categories')
      .delete()
      .eq('tenant_id', body.tenant_id);
    if (delCatsErr) {
      return NextResponse.json(
        { error: 'Failed to clear existing categories', details: delCatsErr.message },
        { status: 500 }
      );
    }
  }

  // Fetch existing categories for case-insensitive merge (empty after a wipe).
  const { data: existingCats, error: catsErr } = await supabase
    .from('menu_categories')
    .select('id, name, sort_order')
    .eq('tenant_id', body.tenant_id);
  if (catsErr) {
    return NextResponse.json({ error: 'Tenant not accessible' }, { status: 403 });
  }

  const nameToId = new Map<string, string>();
  let maxOrder = 0;
  for (const c of existingCats || []) {
    nameToId.set(c.name.toLowerCase().trim(), c.id);
    if (c.sort_order > maxOrder) maxOrder = c.sort_order;
  }

  let categoriesCreated = 0;
  let itemsCreated = 0;

  for (const cat of extracted.categories) {
    const key = cat.name.toLowerCase().trim();
    let catId = nameToId.get(key);
    if (!catId) {
      maxOrder += 1;
      const { data: inserted, error: insertCatErr } = await supabase
        .from('menu_categories')
        .insert({ tenant_id: body.tenant_id, name: cat.name, sort_order: maxOrder })
        .select('id')
        .single();
      if (insertCatErr || !inserted) {
        return NextResponse.json(
          { error: 'Failed to create category', details: insertCatErr?.message },
          { status: 500 }
        );
      }
      catId = inserted.id as string;
      nameToId.set(key, catId);
      categoriesCreated += 1;
    }

    if (cat.items.length === 0) continue;
    const rows = cat.items
      .filter((it) => it.name.trim().length > 0)
      .map((it, idx) => ({
        tenant_id: body.tenant_id,
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
      const { error: itemsErr } = await supabase.from('menu_items').insert(rows);
      if (itemsErr) {
        return NextResponse.json(
          { error: 'Failed to insert items', details: itemsErr.message },
          { status: 500 }
        );
      }
      itemsCreated += rows.length;
    }
  }

  // Handle uncategorized items (category_id stays null).
  const uncategorized = extracted.uncategorized
    .filter((it) => it.name.trim().length > 0)
    .map((it, idx) => ({
      tenant_id: body.tenant_id,
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
  if (uncategorized.length > 0) {
    const { error: uncatErr } = await supabase.from('menu_items').insert(uncategorized);
    if (uncatErr) {
      return NextResponse.json(
        { error: 'Failed to insert uncategorized items', details: uncatErr.message },
        { status: 500 }
      );
    }
    itemsCreated += uncategorized.length;
  }

  return NextResponse.json({
    ok: true,
    mode,
    categories_created: categoriesCreated,
    items_created: itemsCreated,
  });
}
