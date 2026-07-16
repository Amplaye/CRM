import type { BookingStrings } from "@/app/b/[slug]/BookingWidget";
import type { SiteLocale } from "./booking-strings";

// The data contract every site template renders from. Built server-side by
// /s/[slug] (service-role) and client-side by the visual editor (RLS client) —
// same shape, so a template is a pure function of (SiteData, content map).

export interface SiteMenuItem {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  image_url: string | null;
  /** Canonical allergen tokens (empty when none) — shown in the dish detail. */
  allergens: string[];
  /** Canonical tag tokens (vegano/piccante/…) — shown in the dish detail. */
  tags: string[];
}

/** One menu category (or the uncategorized bucket) with its available dishes,
 * used by the in-site full-menu overlay so it reads like the rest of the site
 * instead of sending the guest to a differently-styled /m page. */
export interface SiteMenuCategory {
  id: string;
  name: string;
  items: SiteMenuItem[];
}

export interface SiteReview {
  rating: number;
  comment: string;
  /** First name only — a public site shouldn't print a guest's full name. */
  author: string;
}

export interface SiteHoursRow {
  day: string;
  /** Pre-formatted "12:00–16:00 · 19:30–23:00", or the localized "Closed". */
  value: string;
}

/** Localized generic labels shared by all templates (section fallbacks,
 * contact captions, the booking CTA). Template-specific copy does NOT live
 * here — it ships as editable block defaults inside each template. */
export interface SiteLabels {
  book: string;
  viewMenu: string;
  fullMenu: string;
  about: string;
  menu: string;
  gallery: string;
  reviews: string;
  hours: string;
  contact: string;
  closed: string;
  address: string;
  phone: string;
  map: string;
  giftCta: string;
  giftTitle: string;
  reviewsEmpty: string;
  /** "Allergeni" caption in the dish detail. */
  allergens: string;
  /** aria-label for overlay close buttons. */
  close: string;
  days: string[];
  poweredPrefix: string;
}

export interface SiteData {
  tenantName: string;
  slug: string;
  locale: SiteLocale;
  /** "street, city" joined — "" when the venue block is unset. */
  address: string;
  phone: string;
  mapsHref: string;
  /** Monday-first, localized; empty array when no opening hours configured. */
  hours: SiteHoursRow[];
  /** Teaser pick (photo-first), max 6. */
  menuItems: SiteMenuItem[];
  /** The full menu grouped by category (available dishes only), for the in-site
   * full-menu overlay + dish detail. Empty array when the tenant has no menu. */
  fullMenu: SiteMenuCategory[];
  /** Public 4-5 star reviews with a comment. */
  reviews: SiteReview[];
  avgRating: number;
  /** Google review link (settings.review_url) — "" when unset (CTA hides). */
  reviewUrl: string;
  giftCardsEnabled: boolean;
  labels: SiteLabels;
  bookingStrings: BookingStrings & { title: string };
}
