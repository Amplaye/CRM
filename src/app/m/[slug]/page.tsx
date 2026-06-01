import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  allergenLabel,
  tagLabel,
  collectionLabel,
  type MenuLocale,
  type CollectionKind,
} from "@/lib/menu/labels";

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

  // Unified, ordered section list: collections first, then categories, then the
  // uncategorized bucket. A `prefix` keeps React keys unique when a dish renders
  // in both a collection and its category.
  type Section = { key: string; prefix: string; title: string; items: ItemRow[] };
  const collectionSections: Section[] = colls
    .map((c) => ({
      key: `col-${c.id}`,
      prefix: `col-${c.id}`,
      title: collectionLabel(c.kind, c.name, locale),
      items: itemsByColl.get(c.id) || [],
    }))
    .filter((s) => s.items.length > 0);

  const categorySections: Section[] = cats
    .map((c) => ({ key: `cat-${c.id}`, prefix: `cat-${c.id}`, title: c.name, items: byCat.get(c.id) || [] }))
    .concat(
      byCat.has(null)
        ? [{ key: "uncat", prefix: "uncat", title: ui.other, items: byCat.get(null) || [] }]
        : []
    )
    .filter((s) => s.items.length > 0);

  const sections = [...collectionSections, ...categorySections];
  const isEmpty = sections.length === 0;

  return (
    <div style={{ background: "#fff8ef", minHeight: "100vh" }} className="font-sans text-black">
      <header
        className="px-5 py-8 text-center"
        style={{ background: "linear-gradient(135deg, #d4a574, #c4956a)", color: "white" }}
      >
        <h1 className="text-3xl md:text-4xl font-black tracking-tight">{tenant.name}</h1>
        <p className="text-xs uppercase tracking-widest opacity-90 mt-2">{ui.menu}</p>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        {isEmpty ? (
          <div className="text-center py-16">
            <p className="text-sm text-black/60">{ui.updating}</p>
          </div>
        ) : (
          <div className="space-y-10">
            {sections.map((s) => (
              <section key={s.key}>
                <h2
                  className="text-lg font-black uppercase tracking-widest mb-4 pb-2 border-b-2"
                  style={{ borderColor: "#c4956a" }}
                >
                  {s.title}
                </h2>
                <ul className="space-y-4">
                  {s.items.map((it) => (
                    <li key={`${s.prefix}:${it.id}`}>
                      <div className="flex justify-between items-baseline gap-4">
                        <h3 className="font-bold text-base">{it.name}</h3>
                        {it.price != null && (
                          <span className="text-sm font-bold whitespace-nowrap">
                            {it.price.toFixed(2)} {it.currency === "EUR" ? "€" : it.currency}
                          </span>
                        )}
                      </div>
                      {it.description && (
                        <p className="text-sm text-black/70 leading-relaxed mt-1">{it.description}</p>
                      )}
                      {(it.tags.length > 0 || it.allergens.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {it.tags.map((tg) => (
                            <span
                              key={`${s.prefix}:${it.id}:tag:${tg}`}
                              className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800"
                            >
                              {tagLabel(tg, locale)}
                            </span>
                          ))}
                          {it.allergens.map((al) => (
                            <span
                              key={`${s.prefix}:${it.id}:al:${al}`}
                              className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-orange-100 text-orange-800"
                            >
                              {allergenLabel(al, locale)}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-black/40 py-6">
        Powered by <span className="font-bold">BaliFlow</span>
      </footer>
    </div>
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
