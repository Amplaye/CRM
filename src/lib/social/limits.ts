// Single source of truth for social-media upload limits and accepted types.
// Referenced by the client (social composer) and the upload-url route so the
// caps can never drift between layers. The rendered media (Remotion → WebCodecs)
// is always a jpg (image/carousel frame) or an mp4 (reel), so the whitelist is
// deliberately narrow.

// Reels can run 10–15s at 1080×1920, h264 — a few MB. Cap generously.
export const MAX_SOCIAL_UPLOAD_BYTES = 60 * 1024 * 1024; // 60 MB
export const MAX_SOCIAL_UPLOAD_MB = MAX_SOCIAL_UPLOAD_BYTES / 1024 / 1024;

// Extensions we accept into the social-media bucket, keyed for the upload-url
// route's path builder. jpg for image/carousel frames, mp4 for reels.
export const SOCIAL_EXTENSIONS = ["jpg", "jpeg", "png", "mp4"] as const;
export type SocialExtension = (typeof SOCIAL_EXTENSIONS)[number];

/** Resolve a safe extension from a filename, defaulting to jpg for images. */
export function resolveSocialExtension(fileName: string | undefined | null): SocialExtension {
  const ext = (fileName?.split(".").pop() || "").toLowerCase();
  return (SOCIAL_EXTENSIONS as readonly string[]).includes(ext) ? (ext as SocialExtension) : "jpg";
}
