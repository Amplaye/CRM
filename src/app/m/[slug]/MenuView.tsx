// Public hosted menu, shared via a QR sticker. This file is now a thin ROUTER:
// the server (page.tsx) passes a `style` ("1" | "2" | "3", from ?style=) and we
// mount one of three candidate designs so the owner can compare them live before
// one becomes the default:
//
//   "1" → MenuImmersive — full-screen luxury "stories", giant dish photos
//   "2" → MenuEditorial — gourmet-magazine bento spread, oversized type
//   "3" → MenuCinematic — dark, materic, glassmorphism with gold rim-light
//   "4" → MenuClassic   — the original cream-paper "Maître" fine-dining card
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
  emptyLabel: string;
  featuredLabel: string;
  sections: MenuViewSection[];
};

export default function MenuView({ style, ...rest }: Props) {
  if (style === "2") return <MenuEditorial {...rest} />;
  if (style === "3") return <MenuCinematic {...rest} />;
  if (style === "4") return <MenuClassic {...rest} />;
  return <MenuImmersive {...rest} />;
}
