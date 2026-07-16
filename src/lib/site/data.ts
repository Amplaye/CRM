import type { OpeningHours } from "@/lib/restaurant-rules";
import type { TenantSettings } from "@/lib/types/tenant-settings";
import { BOOKING_STRINGS, resolveSiteLocale } from "./booking-strings";
import { SITE_STRINGS } from "./labels";
import type { SiteData, SiteHoursRow, SiteMenuCategory, SiteMenuItem, SiteReview } from "./types";

// Pure shaping helpers shared by the public /s/[slug] page (service-role rows)
// and the visual editor (RLS client rows): same raw rows in → same SiteData out.

export type RawMenuItemRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  /** Present when the caller selected them (full-menu build); the teaser and
   * older callers can omit them — they default to empty. */
  category_id?: string | null;
  allergens?: string[] | null;
  tags?: string[] | null;
};

export type RawMenuCategoryRow = {
  id: string;
  name: string;
};

export type RawReviewRow = {
  rating: number;
  comment: string;
  guests: { name: string | null } | null;
};

export function formatSitePrice(price: number, currency: string): string {
  const symbol = currency === "EUR" ? "€" : currency;
  return `${price.toFixed(2).replace(/\.00$/, "")} ${symbol}`;
}

/** Distinct room names (restaurant_tables.zone) that have ≥1 active table, in a
 * stable alphabetical order. The widget shows its room-picker step only when
 * this returns 2+ — a single-room venue skips the step entirely. Blank/whitespace
 * zones are ignored so a mis-seeded table can't create a nameless room. */
export function distinctRooms(rows: { zone: string | null }[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const z = (r.zone || "").trim();
    if (z) set.add(z);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** First name only — a public site shouldn't print a guest's full name. */
export function firstName(full: string | null): string {
  const first = (full || "").trim().split(/\s+/)[0];
  return first || "Guest";
}

function shapeMenuItem(r: RawMenuItemRow): SiteMenuItem {
  return {
    id: r.id,
    name: r.name,
    description: r.description || "",
    price: r.price,
    currency: r.currency || "EUR",
    image_url: r.image_url,
    allergens: Array.isArray(r.allergens) ? r.allergens : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
  };
}

/** Menu teaser pick: dishes with a photo sell better, so prefer them. */
export function pickMenuTeaser(rows: RawMenuItemRow[], max = 6): SiteMenuItem[] {
  const shaped = rows.map(shapeMenuItem);
  const withPhoto = shaped.filter((r) => r.image_url);
  return (withPhoto.length >= 3 ? withPhoto : shaped).slice(0, max);
}

/** Group all available dishes by category (categories in their given order,
 * uncategorized last) for the in-site full-menu overlay. Empty categories are
 * dropped so the overlay never shows a bare heading. */
export function buildFullMenu(
  itemRows: RawMenuItemRow[],
  categoryRows: RawMenuCategoryRow[],
  uncategorizedLabel: string,
): SiteMenuCategory[] {
  const byCat = new Map<string | null, SiteMenuItem[]>();
  for (const r of itemRows) {
    const key = r.category_id ?? null;
    const list = byCat.get(key);
    if (list) list.push(shapeMenuItem(r));
    else byCat.set(key, [shapeMenuItem(r)]);
  }
  const out: SiteMenuCategory[] = [];
  for (const cat of categoryRows) {
    const items = byCat.get(cat.id);
    if (items && items.length) out.push({ id: cat.id, name: cat.name, items });
  }
  const loose = byCat.get(null);
  if (loose && loose.length) out.push({ id: "__uncat__", name: uncategorizedLabel, items: loose });
  return out;
}

/** Monday-first localized rows; [] when no day has slots (section hides). */
export function buildHoursRows(hours: OpeningHours, days: string[], closedLabel: string): SiteHoursRow[] {
  const hasAny = Object.values(hours || {}).some((slots) => Array.isArray(slots) && slots.length > 0);
  if (!hasAny) return [];
  // opening_hours keys are "0".."6" with Sunday = 0; render Monday-first.
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  return dayOrder.map((d, i) => {
    const slots = hours[String(d)] || [];
    return {
      day: days[i],
      value: slots.length ? slots.map((s) => `${s.open}–${s.close}`).join(" · ") : closedLabel,
    };
  });
}

export function buildMapsHref(venue: { address?: string; city?: string; maps_short?: string }): string {
  return (
    venue.maps_short ||
    (venue.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.address, venue.city].filter(Boolean).join(", "))}`
      : "")
  );
}

/** Assemble the full template data contract from raw tenant + DB rows. The
 * teaser and the full-menu overlay share `menuRows` (pass every available dish
 * ordered by sort_order); `categoryRows` groups them for the overlay. */
export function buildSiteData(args: {
  tenantName: string;
  slug: string;
  settings: TenantSettings;
  menuRows: RawMenuItemRow[];
  categoryRows?: RawMenuCategoryRow[];
  reviewRows: RawReviewRow[];
  giftCardsEnabled: boolean;
}): SiteData {
  const { tenantName, slug, settings, menuRows, categoryRows = [], reviewRows, giftCardsEnabled } = args;
  const locale = resolveSiteLocale(settings.crm_locale);
  const labels = SITE_STRINGS[locale];

  const venue = (settings.venue || {}) as { address?: string; city?: string; maps_short?: string };
  const phone = typeof settings.restaurant_phone === "string" ? settings.restaurant_phone.trim() : "";
  const reviewUrl = typeof settings.review_url === "string" ? settings.review_url.trim() : "";
  const hours = (settings.opening_hours || {}) as OpeningHours;

  const reviews: SiteReview[] = reviewRows.map((r) => ({
    rating: r.rating,
    comment: r.comment,
    author: firstName(r.guests?.name ?? null),
  }));
  const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  return {
    tenantName,
    slug,
    locale,
    address: [venue.address, venue.city].filter(Boolean).join(", "),
    phone,
    mapsHref: buildMapsHref(venue),
    hours: buildHoursRows(hours, labels.days, labels.closed),
    menuItems: pickMenuTeaser(menuRows),
    fullMenu: buildFullMenu(menuRows, categoryRows, labels.menu),
    reviews,
    avgRating,
    reviewUrl,
    giftCardsEnabled,
    labels,
    bookingStrings: BOOKING_STRINGS[locale],
  };
}
