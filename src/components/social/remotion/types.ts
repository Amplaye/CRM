// Shared prop shapes for the Remotion compositions. A "slide" is one dish the
// composition draws: a photo, a name, an optional price. Kept minimal so the
// composer can build props from menu items without threading the full menu type.

export interface SocialSlide {
  name: string;
  price?: string;
  photoUrl?: string;
}

export interface SocialCompositionProps {
  restaurantName: string;
  /** Accent colour (menu_branding.brand_color), hex. */
  brandColor: string;
  logoUrl?: string;
  slides: SocialSlide[];
}

/** Canonical dimensions per post type. IG square feed vs 9:16 reel. */
export const SOCIAL_DIMENSIONS = {
  image: { width: 1080, height: 1080 },
  carousel: { width: 1080, height: 1080 },
  reels: { width: 1080, height: 1920 },
} as const;

/** Reel timing: seconds per slide at 30fps. */
export const REEL_FPS = 30;
export const REEL_SECONDS_PER_SLIDE = 3;
