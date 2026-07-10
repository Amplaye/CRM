import type { OpeningHours } from "@/lib/restaurant-rules";
import type { TenantSettings } from "@/lib/types/tenant-settings";
import { BOOKING_STRINGS, resolveSiteLocale } from "./booking-strings";
import { SITE_STRINGS } from "./labels";
import type { SiteData, SiteHoursRow, SiteMenuItem, SiteReview } from "./types";

// Pure shaping helpers shared by the public /s/[slug] page (service-role rows)
// and the visual editor (RLS client rows): same raw rows in → same SiteData out.

export type RawMenuItemRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  image_url: string | null;
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

/** First name only — a public site shouldn't print a guest's full name. */
export function firstName(full: string | null): string {
  const first = (full || "").trim().split(/\s+/)[0];
  return first || "Guest";
}

/** Menu teaser pick: dishes with a photo sell better, so prefer them. */
export function pickMenuTeaser(rows: RawMenuItemRow[], max = 6): SiteMenuItem[] {
  const shaped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || "",
    price: r.price,
    currency: r.currency || "EUR",
    image_url: r.image_url,
  }));
  const withPhoto = shaped.filter((r) => r.image_url);
  return (withPhoto.length >= 3 ? withPhoto : shaped).slice(0, max);
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

/** Assemble the full template data contract from raw tenant + DB rows. */
export function buildSiteData(args: {
  tenantName: string;
  slug: string;
  settings: TenantSettings;
  menuRows: RawMenuItemRow[];
  reviewRows: RawReviewRow[];
  giftCardsEnabled: boolean;
}): SiteData {
  const { tenantName, slug, settings, menuRows, reviewRows, giftCardsEnabled } = args;
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
    reviews,
    avgRating,
    reviewUrl,
    giftCardsEnabled,
    labels,
    bookingStrings: BOOKING_STRINGS[locale],
  };
}
