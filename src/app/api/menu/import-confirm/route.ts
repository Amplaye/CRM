import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeExtraction, type ExtractedMenu } from '@/lib/menu/extract';

// Persist a (possibly user-edited) extracted menu into menu_categories +
// menu_items for the given tenant. RLS enforces membership. We do NOT wipe
// existing items — the import is additive. If a category with the same
// (case-insensitive) name already exists, items are appended to it.

export const runtime = 'nodejs';

type Body = {
  tenant_id: string;
  extracted: ExtractedMenu;
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

  // Fetch existing categories for case-insensitive merge.
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
    categories_created: categoriesCreated,
    items_created: itemsCreated,
  });
}
