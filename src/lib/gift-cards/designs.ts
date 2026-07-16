// Gift-card DESIGNS — the cards an owner composes in the dashboard and that the
// public /g/<slug> page sells. Pure module (no supabase, no next) so the editor,
// the public page and the checkout route all validate the SAME shape.
//
// A design is one sellable card: a fixed amount plus its look (title, subtitle,
// colours or a photo). The buyer picks a card instead of typing a number, and
// what they saw is what lands in their inbox — the chosen design's title and
// colours are snapshotted onto the voucher at purchase time, so redesigning a
// card later never rewrites vouchers already sold.
//
// Stored at `tenants.settings.gift_designs`. Absent/empty → the public page
// falls back to the historical preset amounts, so a tenant that never opens the
// editor keeps today's page byte-for-byte.

import { GIFT_MAX_CENTS, GIFT_MIN_CENTS } from "./format";

/** Background treatments a card can use. `solid` and `gradient` need no upload,
 * which keeps a brand-new tenant one click from a card that looks intentional. */
export type GiftDesignStyle = "solid" | "gradient" | "image";

export interface GiftDesign {
  /** Stable id — referenced by purchases, so never reuse one. */
  id: string;
  /** Owner-facing name AND the headline printed on the card ("Cena per due"). */
  title: string;
  /** Optional line under the title ("Menu degustazione, vini inclusi"). */
  subtitle?: string;
  /** Fixed value of this card, in cents. */
  amount_cents: number;
  style: GiftDesignStyle;
  /** Primary colour (solid fill, gradient start, or image text/overlay tint). */
  color: string;
  /** Gradient end colour. Ignored unless style === "gradient". */
  color2?: string;
  /** Public URL in the "branding" bucket. Required when style === "image". */
  image_url?: string;
  /** Card text colour — the owner picks it because a photo can be light or dark. */
  text_color?: string;
  /** Hidden from the public page without deleting it (and without breaking the
   * vouchers that reference it). */
  enabled?: boolean;
}

/** Cards a tenant can publish. A cap keeps the public page a choice, not a
 * catalogue — and keeps `settings` (a single JSONB row read on every page) small. */
export const MAX_GIFT_DESIGNS = 8;

export const DEFAULT_GIFT_TEXT_COLOR = "#ffffff";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** True when the card is publishable: a title, a legal amount, and — for an
 * image card — an actual image. An owner mid-edit can hold an invalid design in
 * the editor; only valid ones reach the public page. */
export function isValidGiftDesign(d: GiftDesign | null | undefined): d is GiftDesign {
  if (!d || typeof d !== "object") return false;
  if (!d.id || typeof d.id !== "string") return false;
  if (!d.title || !d.title.trim()) return false;
  if (!Number.isInteger(d.amount_cents)) return false;
  if (d.amount_cents < GIFT_MIN_CENTS || d.amount_cents > GIFT_MAX_CENTS) return false;
  if (d.style !== "solid" && d.style !== "gradient" && d.style !== "image") return false;
  if (d.style === "image" && !d.image_url) return false;
  if (!HEX.test(d.color || "")) return false;
  if (d.color2 !== undefined && d.color2 !== "" && !HEX.test(d.color2)) return false;
  if (d.text_color !== undefined && d.text_color !== "" && !HEX.test(d.text_color)) return false;
  return true;
}

/** The designs a guest may actually buy: valid, enabled, and capped. Everything
 * that reads designs for the PUBLIC page goes through this — never the raw array. */
export function publishedGiftDesigns(raw: unknown): GiftDesign[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isValidGiftDesign)
    .filter((d) => d.enabled !== false)
    .slice(0, MAX_GIFT_DESIGNS);
}

/** Find the design a purchase refers to, or null when the id is unknown/unsold-
 * able. The checkout route uses this to trust the AMOUNT from the design rather
 * than from the browser. */
export function findGiftDesign(raw: unknown, id: string | null | undefined): GiftDesign | null {
  if (!id) return null;
  return publishedGiftDesigns(raw).find((d) => d.id === id) ?? null;
}

/** The CSS background for a card, shared by the dashboard preview and the public
 * page so "what I designed" and "what they see" cannot drift. */
export function giftDesignBackground(d: GiftDesign): string {
  if (d.style === "image" && d.image_url) {
    // Darkening scrim: photos are unpredictable, the title must stay readable.
    return `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.45)), url("${d.image_url}") center/cover no-repeat`;
  }
  if (d.style === "gradient") {
    return `linear-gradient(135deg, ${d.color}, ${d.color2 || d.color})`;
  }
  return d.color;
}

/** A fresh card, pre-filled so the owner's first click already renders something
 * presentable (the empty-editor problem). */
export function newGiftDesign(accent: string, amountCents = 5000): GiftDesign {
  return {
    id: `gd_${Math.random().toString(36).slice(2, 10)}`,
    title: "",
    subtitle: "",
    amount_cents: amountCents,
    style: "gradient",
    color: HEX.test(accent) ? accent : "#c4956a",
    color2: "#8b6540",
    text_color: DEFAULT_GIFT_TEXT_COLOR,
    enabled: true,
  };
}
