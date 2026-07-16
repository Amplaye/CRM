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
import TableBill, { type TableBillStrings } from "./TableBill";
import { getFeatures } from "@/lib/types/tenant-settings";
import { getSelfOrderConfig, foodUnlockAtMs } from "@/lib/self-order/config";
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
    drinksFirstTitle: "Prima da bere 🍹",
    drinksFirstBody: "Ordina subito le bevande. I piatti si sbloccano tra poco, così la cucina li prepara al meglio.",
    foodLockedBadge: "Presto disponibile", foodUnlockedToast: "Ora puoi ordinare i piatti!",
    foodLockedError: "I piatti non sono ancora disponibili: ordina le bevande e riprova tra poco.",
    minutesShort: "min",
  },
  es: {
    table: "Mesa", add: "Añadir", yourOrder: "Tu pedido", empty: "El carrito está vacío",
    sendOrder: "Enviar pedido", sending: "Enviando…", viewOrder: "Ver pedido", items: "artículos",
    notesPlaceholder: "Notas (alergias, sin cebolla…)", total: "Total", cancel: "Cancelar",
    sentTitle: "¡Pedido enviado!", sentBody: "El personal lo ha recibido y lo prepara enseguida.",
    orderMore: "Pedir más", closedTitle: "Caja cerrada",
    closedBody: "Ahora mismo no se puede pedir desde la mesa: llama al personal.",
    genericError: "No se pudo enviar. Inténtalo de nuevo o llama al personal.",
    drinksFirstTitle: "Primero las bebidas 🍹",
    drinksFirstBody: "Pide ya las bebidas. Los platos se desbloquean en unos minutos, así la cocina los prepara mejor.",
    foodLockedBadge: "Disponible pronto", foodUnlockedToast: "¡Ya puedes pedir los platos!",
    foodLockedError: "Los platos aún no están disponibles: pide las bebidas y vuelve a intentarlo en unos minutos.",
    minutesShort: "min",
  },
  en: {
    table: "Table", add: "Add", yourOrder: "Your order", empty: "Your cart is empty",
    sendOrder: "Send order", sending: "Sending…", viewOrder: "View order", items: "items",
    notesPlaceholder: "Notes (allergies, no onion…)", total: "Total", cancel: "Cancel",
    sentTitle: "Order sent!", sentBody: "The staff received it and will prepare it right away.",
    orderMore: "Order more", closedTitle: "Till closed",
    closedBody: "Table ordering is not available right now: please call the staff.",
    genericError: "Could not send the order. Try again or call the staff.",
    drinksFirstTitle: "Drinks first 🍹",
    drinksFirstBody: "Order your drinks now. The dishes unlock in a few minutes so the kitchen can prepare them at their best.",
    foodLockedBadge: "Available soon", foodUnlockedToast: "You can order dishes now!",
    foodLockedError: "The dishes aren't available yet: order your drinks and try again in a few minutes.",
    minutesShort: "min",
  },
  de: {
    table: "Tisch", add: "Hinzufügen", yourOrder: "Deine Bestellung", empty: "Der Warenkorb ist leer",
    sendOrder: "Bestellung senden", sending: "Wird gesendet…", viewOrder: "Bestellung ansehen", items: "Artikel",
    notesPlaceholder: "Hinweise (Allergien, ohne Zwiebeln…)", total: "Gesamt", cancel: "Abbrechen",
    sentTitle: "Bestellung gesendet!", sentBody: "Das Personal hat sie erhalten und bereitet sie gleich zu.",
    orderMore: "Mehr bestellen", closedTitle: "Kasse geschlossen",
    closedBody: "Bestellen am Tisch ist gerade nicht möglich: bitte das Personal rufen.",
    genericError: "Senden fehlgeschlagen. Erneut versuchen oder das Personal rufen.",
    drinksFirstTitle: "Erst die Getränke 🍹",
    drinksFirstBody: "Bestellt jetzt eure Getränke. Die Gerichte werden in wenigen Minuten freigeschaltet, damit die Küche sie optimal zubereitet.",
    foodLockedBadge: "Bald verfügbar", foodUnlockedToast: "Ihr könnt jetzt Gerichte bestellen!",
    foodLockedError: "Die Gerichte sind noch nicht verfügbar: bestellt Getränke und versucht es in wenigen Minuten erneut.",
    minutesShort: "Min.",
  },
};

// Strings for the pay-at-table sheet (?table= + qr_pay_enabled), same
// server-localized pattern as SELF_ORDER_STRINGS.
const TABLE_PAY_STRINGS: Record<MenuLocale, TableBillStrings> = {
  it: {
    billButton: "Conto", billTitle: "Il tuo conto", loading: "Carico il conto…",
    noBill: "Non c'è ancora un conto aperto per questo tavolo.",
    covers: "Coperto", discount: "Sconto", total: "Totale", pay: "Paga con carta",
    redirecting: "Apro il pagamento…",
    notPayableStripe: "Il pagamento online non è disponibile: paga in cassa o chiama il personale.",
    notPayableClosed: "La cassa è chiusa in questo momento: chiama il personale.",
    confirming: "Confermiamo il pagamento…",
    paidTitle: "Pagato, grazie!", paidBody: "Il conto è stato saldato e chiuso in cassa. Buona giornata!",
    receipt: "Scontrino n.",
    mismatchBody: "Il pagamento è andato a buon fine ma nel frattempo il conto è cambiato: il personale sistemerà la differenza. Grazie!",
    alreadyClosedBody: "Il pagamento è andato a buon fine ma il conto risultava già chiuso: rivolgiti al personale per la verifica.",
    needsStaffBody: "Pagamento ricevuto: il personale completerà la chiusura del conto. Grazie!",
    unpaidBody: "Il pagamento non risulta completato.",
    cancelledNote: "Pagamento annullato.", genericError: "Qualcosa è andato storto. Riprova o chiama il personale.",
    close: "Chiudi", refresh: "Riprova",
  },
  es: {
    billButton: "Cuenta", billTitle: "Tu cuenta", loading: "Cargando la cuenta…",
    noBill: "Todavía no hay una cuenta abierta para esta mesa.",
    covers: "Cubierto", discount: "Descuento", total: "Total", pay: "Pagar con tarjeta",
    redirecting: "Abriendo el pago…",
    notPayableStripe: "El pago online no está disponible: paga en caja o llama al personal.",
    notPayableClosed: "La caja está cerrada ahora mismo: llama al personal.",
    confirming: "Confirmando el pago…",
    paidTitle: "¡Pagado, gracias!", paidBody: "La cuenta se ha saldado y cerrado en caja. ¡Buen día!",
    receipt: "Ticket n.º",
    mismatchBody: "El pago se realizó pero la cuenta cambió mientras tanto: el personal ajustará la diferencia. ¡Gracias!",
    alreadyClosedBody: "El pago se realizó pero la cuenta ya estaba cerrada: consulta con el personal.",
    needsStaffBody: "Pago recibido: el personal completará el cierre de la cuenta. ¡Gracias!",
    unpaidBody: "El pago no consta como completado.",
    cancelledNote: "Pago cancelado.", genericError: "Algo salió mal. Inténtalo de nuevo o llama al personal.",
    close: "Cerrar", refresh: "Reintentar",
  },
  en: {
    billButton: "Bill", billTitle: "Your bill", loading: "Loading your bill…",
    noBill: "There's no open bill for this table yet.",
    covers: "Cover charge", discount: "Discount", total: "Total", pay: "Pay by card",
    redirecting: "Opening payment…",
    notPayableStripe: "Online payment isn't available: pay at the till or call the staff.",
    notPayableClosed: "The till is closed right now: please call the staff.",
    confirming: "Confirming your payment…",
    paidTitle: "Paid, thank you!", paidBody: "Your bill has been settled and closed at the till. Have a great day!",
    receipt: "Receipt no.",
    mismatchBody: "Your payment went through, but the bill changed in the meantime: the staff will sort out the difference. Thank you!",
    alreadyClosedBody: "Your payment went through, but the bill was already closed: please check with the staff.",
    needsStaffBody: "Payment received: the staff will finish closing the bill. Thank you!",
    unpaidBody: "The payment doesn't appear to be completed.",
    cancelledNote: "Payment cancelled.", genericError: "Something went wrong. Try again or call the staff.",
    close: "Close", refresh: "Retry",
  },
  de: {
    billButton: "Rechnung", billTitle: "Deine Rechnung", loading: "Rechnung wird geladen…",
    noBill: "Für diesen Tisch gibt es noch keine offene Rechnung.",
    covers: "Gedeck", discount: "Rabatt", total: "Gesamt", pay: "Mit Karte zahlen",
    redirecting: "Zahlung wird geöffnet…",
    notPayableStripe: "Online-Zahlung ist nicht verfügbar: an der Kasse zahlen oder das Personal rufen.",
    notPayableClosed: "Die Kasse ist gerade geschlossen: bitte das Personal rufen.",
    confirming: "Zahlung wird bestätigt…",
    paidTitle: "Bezahlt, danke!", paidBody: "Die Rechnung wurde beglichen und an der Kasse geschlossen. Schönen Tag!",
    receipt: "Bon Nr.",
    mismatchBody: "Die Zahlung war erfolgreich, aber die Rechnung hat sich inzwischen geändert: das Personal klärt die Differenz. Danke!",
    alreadyClosedBody: "Die Zahlung war erfolgreich, aber die Rechnung war bereits geschlossen: bitte beim Personal nachfragen.",
    needsStaffBody: "Zahlung erhalten: das Personal schließt die Rechnung ab. Danke!",
    unpaidBody: "Die Zahlung scheint nicht abgeschlossen zu sein.",
    cancelledNote: "Zahlung abgebrochen.", genericError: "Etwas ist schiefgelaufen. Erneut versuchen oder das Personal rufen.",
    close: "Schließen", refresh: "Erneut versuchen",
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const features = getFeatures(tenant.settings as any);
  let orderTable: { id: string; name: string } | null = null;
  let payTable: { id: string; name: string } | null = null;
  if (tableRaw && (features.self_order_enabled || features.qr_pay_enabled)) {
    const { data: tableRow } = await sb
      .from("restaurant_tables")
      .select("id, name")
      .eq("id", tableRaw)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (tableRow) {
      const resolved = { id: tableRow.id, name: tableRow.name || "" };
      if (features.self_order_enabled) orderTable = resolved;
      // Pay-at-table rides the SAME QR: overlay the bill sheet on whichever
      // menu mode renders (self-order UI or the showcase templates).
      if (features.qr_pay_enabled) payTable = resolved;
    }
  }

  // Drinks-first cooldown seed: if this table already has an OPEN bill, its food
  // lock is already counting from that bill's opened_at — so a guest who scans
  // again mid-cooldown sees the SAME countdown, not a fresh one. No open bill yet
  // → null, and the client starts the clock when the guest sends their first
  // (drinks) order. The set of drink item ids lets the client lock food dishes.
  const selfOrderCfg = getSelfOrderConfig(tenant.settings as any);
  let initialFoodUnlockAt: string | null = null;
  if (orderTable) {
    const { data: openBill } = await sb
      .from("cassa_orders")
      .select("opened_at")
      .eq("tenant_id", tenant.id)
      .eq("table_id", orderTable.id)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (openBill?.opened_at) {
      initialFoodUnlockAt = new Date(foodUnlockAtMs(new Date(openBill.opened_at).getTime())).toISOString();
    }
  }

  // Return leg from Stripe Checkout (?pay=success&cs=<session>|?pay=cancel).
  const payRaw = Array.isArray(sp.pay) ? sp.pay[0] : sp.pay;
  const csRaw = Array.isArray(sp.cs) ? sp.cs[0] : sp.cs;
  const paySessionId = payTable && payRaw === "success" && typeof csRaw === "string" && csRaw ? csRaw : undefined;
  const payCancelled = !!payTable && payRaw === "cancel";

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
    // A dish is a "drink" when its HOME category is one the owner flagged. Keyed
    // by item id (not section) so a drink featured in a "Consigliati" collection
    // is still treated as a drink there — the client uses this to keep drinks
    // orderable while food dishes stay locked during the cooldown.
    const drinkCats = new Set(selfOrderCfg.drink_category_ids);
    const drinkById = new Map(items.map((it) => [it.id, it.category_id != null && drinkCats.has(it.category_id)]));
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
            isDrink: drinkById.get(it.id) ?? false,
          })),
      }))
      .filter((s) => s.items.length > 0);
    // Only bother the client with the cooldown when the owner actually flagged
    // drinks — with no drink category the whole menu is food and locking it on
    // arrival would just block everyone, so we leave ordering unrestricted.
    const cooldownActive = drinkCats.size > 0;

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
          cooldownActive={cooldownActive}
          cooldownMin={selfOrderCfg.cooldown_min}
          initialFoodUnlockAt={initialFoodUnlockAt}
        />
        {payTable && (
          <TableBill
            slug={tenant.slug}
            tableId={payTable.id}
            strings={TABLE_PAY_STRINGS[locale]}
            initialSessionId={paySessionId}
            initialCancelled={payCancelled}
          />
        )}
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
      {payTable && (
        <TableBill
          slug={tenant.slug}
          tableId={payTable.id}
          strings={TABLE_PAY_STRINGS[locale]}
          initialSessionId={paySessionId}
          initialCancelled={payCancelled}
        />
      )}
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
