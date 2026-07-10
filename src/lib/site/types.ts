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
  /** Public 4–5★ reviews with a comment. */
  reviews: SiteReview[];
  avgRating: number;
  /** Google review link (settings.review_url) — "" when unset (CTA hides). */
  reviewUrl: string;
  giftCardsEnabled: boolean;
  labels: SiteLabels;
  bookingStrings: BookingStrings & { title: string };
}
