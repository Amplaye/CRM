// Dish-photo extraction for menu import.
// ---------------------------------------------------------------------------
// When a customer imports a PDF menu that ALREADY has a photo next to each
// dish, we pull those embedded images out of the PDF and offer to attach them
// to the matching dish (menu_items.image_url) — so the owner doesn't re-upload
// every photo by hand.
//
// Why this lives client-side (mostly): unpdf's extractImages() returns DECODED
// raw pixel buffers (RGBA/RGB/grayscale), NOT the original compressed bytes.
// Turning raw pixels into a storable .webp needs an encoder (canvas), which the
// free Vercel/Deno runtimes don't have but a browser does. The browser also
// already holds the uploaded File, so extraction needs no extra storage trip.
//
// This module holds the PURE, testable pieces: the candidate filter (which
// extracted images look like dish photos vs logos/dividers) and the
// dish-name → {c,i} correlation. The browser-only canvas encode and the unpdf
// call live in the client component; the AI pairing lives in the
// /api/menu/match-photos route. Keeping these pure keeps them unit-tested.

import type { ExtractedMenu } from './extract';
import { normForMatch } from './collection-match';

// A raw image as unpdf's extractImages() yields it (see node_modules/unpdf
// ExtractedImageObject). We only need the geometry for filtering; `data` is
// handled by the browser canvas code.
export type RawExtractedImage = {
  width: number;
  height: number;
  channels: 1 | 3 | 4;
  /** unpdf's per-image key; stable within a page. */
  key?: string;
};

// A candidate dish photo: an extracted image that passed the heuristic, tagged
// with where it came from so the client can re-extract its pixels and the AI
// can refer to it by a stable index.
export type PhotoCandidate = {
  /** 1-based PDF page the image was found on. */
  page: number;
  /** Index of the image WITHIN that page, in unpdf extraction order. */
  indexOnPage: number;
  width: number;
  height: number;
};

// Heuristic bounds for "could be a dish photo". Tuned against a real sushi menu
// where dish thumbnails were ~110-200px and full-bleed page backgrounds were
// 850-1700px wide. We DON'T assume "bigger = dish": in that menu the big images
// were decorative banners and the dishes were the small tiles. So we keep a
// generous window and let the AI make the final dish-vs-not call.
const MIN_EDGE = 90; // px: below this it's an icon/spacer/bullet, not a photo
// px: above this it's almost surely a full-page background/banner, not a single
// dish photo. Tuned against a real sushi menu where dish photos topped out
// ~430-615px while page backgrounds were 850-1700px on the long edge.
const MAX_EDGE = 1000;
const MIN_RATIO = 0.3; // drop thin strips (dividers, rules, banners)
const MAX_RATIO = 3.2;

/**
 * Decide whether one extracted image is plausibly a dish photo. Pure +
 * geometry-only so it runs identically in Node (tests) and the browser.
 * Deliberately permissive — false positives are fine (the AI pairing step and
 * the user's preview both prune), false negatives lose a real photo forever.
 */
export function isPhotoCandidate(img: RawExtractedImage): boolean {
  const w = img.width;
  const h = img.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  const shortEdge = Math.min(w, h);
  const longEdge = Math.max(w, h);
  if (shortEdge < MIN_EDGE) return false;
  if (longEdge > MAX_EDGE) return false;
  const ratio = w / h;
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) return false;
  return true;
}

/**
 * Filter a page's extracted images down to candidates, preserving per-page
 * order (the index the client will use to re-fetch the pixels).
 */
export function selectCandidates(page: number, images: RawExtractedImage[]): PhotoCandidate[] {
  const out: PhotoCandidate[] = [];
  images.forEach((img, indexOnPage) => {
    if (isPhotoCandidate(img)) {
      out.push({ page, indexOnPage, width: img.width, height: img.height });
    }
  });
  return out;
}

// Flat view of every dish in the menu with its {c,i} coordinate, used by the
// correlation step. `c = -1` is the uncategorized bucket (mirrors the
// convention in extract.ts collectEnrichSlots).
export type DishRef = { c: number; i: number; name: string };

export function flattenDishes(menu: ExtractedMenu): DishRef[] {
  const out: DishRef[] = [];
  menu.categories.forEach((cat, c) =>
    cat.items.forEach((it, i) => out.push({ c, i, name: it.name }))
  );
  menu.uncategorized.forEach((it, i) => out.push({ c: -1, i, name: it.name }));
  return out;
}

/**
 * Resolve a dish name returned by the AI pairing step to a concrete {c,i}.
 * Accent/case-insensitive (reuses normForMatch). Tries, in order:
 *   1. exact normalized equality
 *   2. unique substring (one dish contains the query or vice-versa)
 * Returns null if there's no match or the match is ambiguous (more than one
 * equally-good candidate) — ambiguity should drop to "unmatched" rather than
 * guess and mis-pair, which the user would have to notice and undo.
 */
export function correlateDishName(name: string, dishes: DishRef[]): DishRef | null {
  const q = normForMatch(name);
  if (!q) return null;

  // 1. Exact normalized equality.
  const exact = dishes.filter((d) => normForMatch(d.name) === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null; // ambiguous duplicate name → don't guess

  // 2. Substring either direction. Require a single best (longest dish-name)
  //    hit; if several tie on length it's ambiguous.
  const subs = dishes.filter((d) => {
    const dn = normForMatch(d.name);
    return dn.length > 0 && (dn.includes(q) || q.includes(dn));
  });
  if (subs.length === 0) return null;
  let best: DishRef | null = null;
  let bestLen = -1;
  let tie = false;
  for (const d of subs) {
    const len = normForMatch(d.name).length;
    if (len > bestLen) {
      best = d;
      bestLen = len;
      tie = false;
    } else if (len === bestLen) {
      tie = true;
    }
  }
  return tie ? null : best;
}
