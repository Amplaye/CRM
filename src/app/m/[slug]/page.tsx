import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { Fraunces, Manrope, Playfair_Display, Cormorant_Garamond } from "next/font/google";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  allergenLabel,
  tagLabel,
  collectionLabel,
  type MenuLocale,
  type CollectionKind,
} from "@/lib/menu/labels";
import MenuView, { type MenuViewSection } from "./MenuView";
import SelfOrderMenu, { type SelfOrderSection, type SelfOrderStrings } from "./SelfOrderMenu";
import { getFeatures } from "@/lib/types/tenant-settings";
import type { MenuItemVariant } from "@/lib/types";

// The public menu has its own premium typographic voice, loaded only on this
// route (next/font works in any server component). Fraunces — a high-contrast,
// optically-sized display serif with real character — is the DEFAULT wordmark/
// heading face; Manrope is the clean grotesque for body copy. MenuView reads both
// via CSS variables.
//
// menu_branding.font lets the owner pick a different display serif. All three
// expose the SAME `--font-display` variable, so applying the chosen font's
// `.variable` className on the wrapper both loads its stylesheet and rebinds the
// variable — one class swap re-skins the headings across all 4 templates. (Only
// the selected font's CSS links into a given render; the other two never ship.)
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});
const playfair = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});
const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/** Map the saved menu_branding.font choice to its loaded next/font object.
 * Unknown / unset → Fraunces (the default display serif). */
const DISPLAY_FONTS = { fraunces, playfair, cormorant } as const;

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
  settings: {
    timezone?: string;
    currency?: string;
    crm_locale?: string;
    /** Saved public-menu template: "1"|"2"|"3"|"4". Defaults to "1". */
    menu_style?: string;
    /** Owner's public-menu branding (Idea 2): accent colour, logo, display font. */
    menu_branding?: {
      brand_color?: string;
      logo_url?: string;
      font?: "fraunces" | "playfair" | "cormorant";
    };
  };
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
const PUBLIC_STRINGS: Record<
  MenuLocale,
  { menu: string; updating: string; other: string; featured: string }
> = {
  it: { menu: "Menu", updating: "Menù in aggiornamento.", other: "Altro", featured: "Selezione" },
  es: { menu: "Carta", updating: "Carta en actualización.", other: "Otros", featured: "Selección" },
  en: { menu: "Menu", updating: "Menu being updated.", other: "Other", featured: "Selection" },
  de: { menu: "Speisekarte", updating: "Speisekarte wird aktualisiert.", other: "Sonstiges", featured: "Auswahl" },
};

// Strings for the table self-order mode (?table=<id>), same server-localized
// pattern as PUBLIC_STRINGS — the whole flow speaks the tenant's language.
const SELF_ORDER_STRINGS: Record<MenuLocale, SelfOrderStrings> = {
  it: {
    table: "Tavolo", add: "Aggiungi", yourOrder: "Il tuo ordine", empty: "Il carrello è vuoto",
    sendOrder: "Invia ordine", sending: "Invio…", viewOrder: "Vedi ordine", items: "articoli",
    notesPlaceholder: "Note (allergie, senza cipolla…)", total: "Totale", cancel: "Annulla",
    sentTitle: "Ordine inviato!", sentBody: "Il personale l'ha ricevuto e lo prepara al più presto.",
    orderMore: "Ordina ancora", closedTitle: "Cassa chiusa",
    closedBody: "In questo momento non è possibile ordinare dal tavolo: chiama il personale.",
    genericError: "Invio non riuscito. Riprova o chiama il personale.",
  },
  es: {
    table: "Mesa", add: "Añadir", yourOrder: "Tu pedido", empty: "El carrito está vacío",
    sendOrder: "Enviar pedido", sending: "Enviando…", viewOrder: "Ver pedido", items: "artículos",
    notesPlaceholder: "Notas (alergias, sin cebolla…)", total: "Total", cancel: "Cancelar",
    sentTitle: "¡Pedido enviado!", sentBody: "El personal lo ha recibido y lo prepara enseguida.",
    orderMore: "Pedir más", closedTitle: "Caja cerrada",
    closedBody: "Ahora mismo no se puede pedir desde la mesa: llama al personal.",
    genericError: "No se pudo enviar. Inténtalo de nuevo o llama al personal.",
  },
  en: {
    table: "Table", add: "Add", yourOrder: "Your order", empty: "Your cart is empty",
    sendOrder: "Send order", sending: "Sending…", viewOrder: "View order", items: "items",
    notesPlaceholder: "Notes (allergies, no onion…)", total: "Total", cancel: "Cancel",
    sentTitle: "Order sent!", sentBody: "The staff received it and will prepare it right away.",
    orderMore: "Order more", closedTitle: "Till closed",
    closedBody: "Table ordering is not available right now: please call the staff.",
    genericError: "Could not send the order. Try again or call the staff.",
  },
  de: {
    table: "Tisch", add: "Hinzufügen", yourOrder: "Deine Bestellung", empty: "Der Warenkorb ist leer",
    sendOrder: "Bestellung senden", sending: "Wird gesendet…", viewOrder: "Bestellung ansehen", items: "Artikel",
    notesPlaceholder: "Hinweise (Allergien, ohne Zwiebeln…)", total: "Gesamt", cancel: "Abbrechen",
    sentTitle: "Bestellung gesendet!", sentBody: "Das Personal hat sie erhalten und bereitet sie gleich zu.",
    orderMore: "Mehr bestellen", closedTitle: "Kasse geschlossen",
    closedBody: "Bestellen am Tisch ist gerade nicht möglich: bitte das Personal rufen.",
    genericError: "Senden fehlgeschlagen. Erneut versuchen oder das Personal rufen.",
  },
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
  image_url: string | null;
  sort_order: number;
  /** Only selected in order mode (?table=); null/absent otherwise. */
  variants?: MenuItemVariant[] | null;
};

export default async function PublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // ?style=1|2|3|4 is a transient PREVIEW override (used by the CRM preview
  // selector). The real default is the template the owner saved in the CRM,
  // read below from tenant.settings.menu_style.
  const styleRaw = Array.isArray(sp.style) ? sp.style[0] : sp.style;
  const previewStyle = ["1", "2", "3", "4"].includes(styleRaw ?? "")
    ? (styleRaw as "1" | "2" | "3" | "4")
    : null;
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

  // ── Self-order mode: ?table=<id> + feature flag ──
  // The QR on the table adds ?table=<restaurant_tables.id>. When the tenant has
  // self-ordering ON and the id belongs to it, the page renders the ordering UI
  // instead of the showcase templates. Any mismatch degrades to the plain menu.
  const tableRaw = Array.isArray(sp.table) ? sp.table[0] : sp.table;
  let orderTable: { id: string; name: string } | null = null;
  if (tableRaw && getFeatures(tenant.settings as any).self_order_enabled) {
    const { data: tableRow } = await sb
      .from("restaurant_tables")
      .select("id, name")
      .eq("id", tableRaw)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (tableRow) orderTable = { id: tableRow.id, name: tableRow.name || "" };
  }

  // Final template: a ?style preview override wins (transient), otherwise the
  // owner's saved choice, otherwise "1" (Immersive).
  const savedRaw = tenant.settings?.menu_style;
  const savedStyle = ["1", "2", "3", "4"].includes(savedRaw ?? "")
    ? (savedRaw as "1" | "2" | "3" | "4")
    : "1";
  const style = previewStyle ?? savedStyle;

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
          "id,category_id,name,description,price,currency,allergens,tags,available,image_url,sort_order" +
            // The order flow needs each dish's variant options; the plain menu doesn't.
            (orderTable ? ",variants" : "")
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
    image_url: it.image_url,
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

  // Owner branding (Idea 2): a custom accent colour cascades into all 4 templates
  // via the --accent CSS var (each template's primary accent reads
  // `var(--accent, <its default>)`), the chosen display font is applied as a class
  // that rebinds --font-display, and the logo is threaded to MenuView.
  const mb = tenant.settings?.menu_branding;
  const displayFont = DISPLAY_FONTS[mb?.font ?? "fraunces"] ?? fraunces;
  const wrapStyle = mb?.brand_color
    ? ({ ["--accent" as string]: mb.brand_color } as CSSProperties)
    : undefined;

  // Self-order mode renders its own functional UI (cart, variants, submit) —
  // the four showcase templates stay untouched.
  if (orderTable) {
    const variantsById = new Map(
      items.map((it) => [it.id, Array.isArray(it.variants) ? it.variants : []])
    );
    const orderSections: SelfOrderSection[] = sections
      .map((s) => ({
        key: s.key,
        title: s.title,
        featured: s.featured,
        items: s.items
          .filter((it) => it.price != null)
          .map((it) => ({
            id: it.id,
            name: it.name,
            description: it.description,
            price: it.price as number,
            image_url: it.image_url,
            allergenLabels: it.allergenLabels,
            variants: variantsById.get(it.id) || [],
          })),
      }))
      .filter((s) => s.items.length > 0);

    return (
      <div className={`${displayFont.variable} ${manrope.variable}`} style={wrapStyle}>
        <SelfOrderMenu
          slug={tenant.slug}
          tableId={orderTable.id}
          tableName={orderTable.name}
          restaurantName={tenant.name}
          logoUrl={mb?.logo_url}
          sections={orderSections}
          strings={SELF_ORDER_STRINGS[locale]}
          emptyLabel={ui.updating}
        />
      </div>
    );
  }

  return (
    <div className={`${displayFont.variable} ${manrope.variable}`} style={wrapStyle}>
      <MenuView
        style={style}
        restaurantName={tenant.name}
        menuLabel={ui.menu}
        emptyLabel={ui.updating}
        featuredLabel={ui.featured}
        sections={sections}
        logoUrl={mb?.logo_url}
      />
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
