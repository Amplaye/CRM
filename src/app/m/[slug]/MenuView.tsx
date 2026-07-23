// Public hosted menu, shared via a QR sticker. This file is a thin ROUTER:
// the server (page.tsx) passes a `style` ("1"…"4", saved choice or ?style=
// preview) and we mount one of the four designs:
//
//   "1" → MenuImmersive — dark photo-first gallery, bento grid on desktop
//   "2" → MenuEditorial — light gourmet-magazine issue, TOC rail + scrollspy
//   "3" → MenuCinematic — near-black glass panels, gold leaders, tab filter
//   "4" → MenuClassic   — cream-paper printed carte on walnut, star dividers
//
// All four consume the exact same flat, server-localized sections (including the
// new optional per-dish `image_url`). The shared shape lives here and is the
// single source of truth that page.tsx imports.

import MenuImmersive from "./MenuImmersive";
import MenuEditorial from "./MenuEditorial";
import MenuCinematic from "./MenuCinematic";
import MenuClassic from "./MenuClassic";

export type MenuViewItem = {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string;
  tags: string[];
  allergens: string[];
  image_url: string | null;
  tagLabels: string[];
  allergenLabels: string[];
};

export type MenuViewSection = {
  key: string;
  prefix: string;
  title: string;
  /** True for collection sections (Consigliati, Specialità…) so we can badge them. */
  featured: boolean;
  items: MenuViewItem[];
};

export type MenuStyle = "1" | "2" | "3" | "4";

type Props = {
  style: MenuStyle;
  restaurantName: string;
  menuLabel: string;
  backLabel: string;
  emptyLabel: string;
  featuredLabel: string;
  /** Copy for the tag filter row all four templates render. */
  filterLabels: { all: string; noMatch: string };
  sections: MenuViewSection[];
  /** Optional owner-uploaded menu logo (menu_branding.logo_url). When set, each
   * template renders it in the header next to / above the wordmark. */
  logoUrl?: string;
};

export default function MenuView({ style, ...rest }: Props) {
  if (style === "2") return <MenuEditorial {...rest} />;
  if (style === "3") return <MenuCinematic {...rest} />;
  if (style === "4") return <MenuClassic {...rest} />;
  return <MenuImmersive {...rest} />;
}
