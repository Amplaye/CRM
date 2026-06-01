import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  allergenLabel,
  tagLabel,
  collectionLabel,
  type MenuLocale,
  type CollectionKind,
} from "@/lib/menu/labels";
import MenuView, { type MenuViewSection } from "./MenuView";

// Public hosted menu page. No auth, no cookies, no JS framework needed for
// the content path. The CRM owner shares /m/<slug> as a QR target so the
// menu stays editable in the CRM while the QR sticker remains the same.
//
// We hide unavailable items so the restaurant can mark "esaurito" live
// without re-publishing.

type Params = { slug: string };

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  settings: { timezone?: string; currency?: string; crm_locale?: string };
};

// The public menu shows the language the restaurant operates in (its CRM locale),
// chosen once at onboarding. There's no per-visitor switcher here — a sticker QR
// points at one menu. Falls back to Italian to match the stored token vocabulary.
const VALID_LOCALES: MenuLocale[] = ["it", "es", "en", "de"];
function resolveLocale(raw: unknown): MenuLocale {
  return VALID_LOCALES.includes(raw as MenuLocale) ? (raw as MenuLocale) : "it";
}

// The handful of static strings on this page, localized alongside the chips so
// the whole public menu speaks one language.
const PUBLIC_STRINGS: Record<MenuLocale, { menu: string; updating: string; other: string }> = {
  it: { menu: "Menu", updating: "Menù in aggiornamento.", other: "Altro" },
  es: { menu: "Carta", updating: "Carta en actualización.", other: "Otros" },
  en: { menu: "Menu", updating: "Menu being updated.", other: "Other" },
  de: { menu: "Speisekarte", updating: "Speisekarte wird aktualisiert.", other: "Sonstiges" },
};

type CategoryRow = { id: string; name: string; sort_order: number };

type CollectionRow = {
  id: string;
  name: string;
  kind: CollectionKind | null;
  sort_order: number;
};

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

export default async function PublicMenuPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();

  const { data: tenant } = (await sb
    .from("tenants")
    .select("id,name,slug,status,settings")
    .eq("slug", slug)
    .maybeSingle()) as { data: TenantRow | null };

  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
    notFound();
  }

  const locale = resolveLocale(tenant.settings?.crm_locale);
  const ui = PUBLIC_STRINGS[locale];

  const [{ data: catsRaw }, { data: itemsRaw }, { data: collsRaw }, { data: linksRaw }] =
    await Promise.all([
      sb
        .from("menu_categories")
        .select("id,name,sort_order")
        .eq("tenant_id", tenant.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      sb
        .from("menu_items")
        .select(
          "id,category_id,name,description,price,currency,allergens,tags,available,sort_order"
        )
        .eq("tenant_id", tenant.id)
        .eq("available", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      sb
        .from("menu_collections")
        .select("id,name,kind,sort_order")
        .eq("tenant_id", tenant.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      sb
        .from("menu_collection_items")
        .select("collection_id,item_id")
        .eq("tenant_id", tenant.id),
    ]);

  const cats = (catsRaw || []) as CategoryRow[];
  const items = (itemsRaw || []) as ItemRow[];
  const colls = (collsRaw || []) as CollectionRow[];
  const links = (linksRaw || []) as { collection_id: string; item_id: string }[];

  const byCat = new Map<string | null, ItemRow[]>();
  for (const it of items) {
    const k = it.category_id;
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(it);
  }

  // Collection sections: resolve each collection's links to the available items
  // (an esaurito dish silently drops, same as categories). A dish legitimately
  // appears both in its collection section and in its home category — that
  // duplication is intended (e.g. Tiramisù under "Consigliati" AND "Dolci").
  const availableById = new Map<string, ItemRow>(items.map((it) => [it.id, it]));
  const itemsByColl = new Map<string, ItemRow[]>();
  for (const l of links) {
    const dish = availableById.get(l.item_id);
    if (!dish) continue;
    const list = itemsByColl.get(l.collection_id);
    if (list) list.push(dish);
    else itemsByColl.set(l.collection_id, [dish]);
  }
  for (const list of itemsByColl.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  // Unified, ordered section list: collections (the chef's picks) first, then
  // categories, then the uncategorized bucket. A `prefix` keeps React keys
  // unique when a dish renders in both a collection and its category. Labels
  // are localized here on the server so the client view stays a pure renderer.
  const toViewItem = (it: ItemRow) => ({
    id: it.id,
    name: it.name,
    description: it.description,
    price: it.price,
    currency: it.currency,
    tags: it.tags,
    allergens: it.allergens,
    tagLabels: it.tags.map((tg) => tagLabel(tg, locale)),
    allergenLabels: it.allergens.map((al) => allergenLabel(al, locale)),
  });

  const collectionSections: MenuViewSection[] = colls
    .map((c) => ({
      key: `col-${c.id}`,
      prefix: `col-${c.id}`,
      title: collectionLabel(c.kind, c.name, locale),
      featured: true,
      items: (itemsByColl.get(c.id) || []).map(toViewItem),
    }))
    .filter((s) => s.items.length > 0);

  const categorySections: MenuViewSection[] = cats
    .map((c) => ({
      key: `cat-${c.id}`,
      prefix: `cat-${c.id}`,
      title: c.name,
      featured: false,
      items: (byCat.get(c.id) || []).map(toViewItem),
    }))
    .concat(
      byCat.has(null)
        ? [
            {
              key: "uncat",
              prefix: "uncat",
              title: ui.other,
              featured: false,
              items: (byCat.get(null) || []).map(toViewItem),
            },
          ]
        : []
    )
    .filter((s) => s.items.length > 0);

  const sections = [...collectionSections, ...categorySections];

  return (
    <MenuView
      restaurantName={tenant.name}
      menuLabel={sections.length === 0 ? ui.updating : ui.menu}
      sections={sections}
    />
  );
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const sb = createServiceRoleClient();
  const { data } = (await sb
    .from("tenants")
    .select("name")
    .eq("slug", slug)
    .maybeSingle()) as { data: { name: string } | null };
  return {
    title: data?.name ? `Menu — ${data.name}` : "Menu",
    description: data?.name ? `Il menu di ${data.name}` : "Menu del ristorante",
  };
}
