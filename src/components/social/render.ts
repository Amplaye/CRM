"use client";

// Browser-side Remotion render + upload. renderMediaOnWeb() runs the composition
// through WebCodecs (GPU, Chromium only) and returns a Blob — zero server cost.
// We then push the Blob to the PUBLIC social-media bucket via a signed upload URL
// (same signed-URL flow as menu imports) and hand back the public URL that goes
// into social_posts.media_urls (Meta cURLs it when publishing).
//
// Reels/video encode only on Chromium (Chrome/Edge/Brave). isVideoRenderSupported
// lets the UI hide the Reel option on Safari instead of failing mid-render.

import { renderMediaOnWeb } from "@remotion/web-renderer";
import { createClient } from "@/lib/supabase/client";
import { SOCIAL_DIMENSIONS, REEL_FPS, REEL_SECONDS_PER_SLIDE, type SocialCompositionProps } from "./remotion/types";
import { PostCard } from "./remotion/PostCard";
import { CarouselSlide } from "./remotion/Carousel";
import { Reel } from "./remotion/Reel";

const SOCIAL_BUCKET = "social-media";

/** WebCodecs video encode is Chromium-only. Used to gate the Reel option. */
export function isVideoRenderSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as { VideoEncoder?: unknown }).VideoEncoder === "function";
}

/** Upload a rendered Blob to the public bucket, returning its public URL. */
async function uploadBlob(tenantId: string, blob: Blob, ext: "jpg" | "mp4"): Promise<string> {
  const res = await fetch("/api/social/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, file_name: `render.${ext}` }),
  });
  if (!res.ok) throw new Error(`upload-url ${res.status}`);
  const { path, token, publicUrl } = (await res.json()) as { path: string; token: string; publicUrl: string };

  const supabase = createClient();
  const { error } = await supabase.storage.from(SOCIAL_BUCKET).uploadToSignedUrl(path, token, blob);
  if (error) throw new Error(`upload failed: ${error.message}`);
  return publicUrl;
}

/** Render a single 1080×1080 still (image or one carousel slide) to a jpg Blob. */
async function renderStill(
  component: React.FC<Record<string, unknown>>,
  inputProps: Record<string, unknown>,
): Promise<Blob> {
  const { width, height } = SOCIAL_DIMENSIONS.image;
  const result = await renderMediaOnWeb({
    composition: { id: "still", component, durationInFrames: 1, fps: 30, width, height },
    inputProps,
    // A single frame → still image container.
    container: "mp4",
    videoCodec: "h264",
  } as Parameters<typeof renderMediaOnWeb>[0]);
  return result.getBlob();
}

export interface RenderRequest {
  tenantId: string;
  postType: "image" | "carousel" | "reels";
  props: SocialCompositionProps;
  onProgress?: (label: string) => void;
}

/**
 * Render the chosen post type in the browser and upload the result(s). Returns
 * the public URLs to store in social_posts.media_urls (one for image/reel, N for
 * a carousel). Throws on unsupported browser or a failed render/upload — the UI
 * shows the message.
 */
export async function renderAndUpload(req: RenderRequest): Promise<string[]> {
  const { tenantId, postType, props, onProgress } = req;

  if (postType === "reels") {
    if (!isVideoRenderSupported()) throw new Error("reel_unsupported_browser");
    onProgress?.("rendering");
    const slides = props.slides.length ? props.slides : [{ name: props.restaurantName }];
    const { width, height } = SOCIAL_DIMENSIONS.reels;
    const durationInFrames = slides.length * REEL_SECONDS_PER_SLIDE * REEL_FPS;
    const result = await renderMediaOnWeb({
      composition: {
        id: "reel",
        component: Reel as unknown as React.FC<Record<string, unknown>>,
        durationInFrames,
        fps: REEL_FPS,
        width,
        height,
      },
      inputProps: props as unknown as Record<string, unknown>,
      container: "mp4",
      videoCodec: "h264",
    } as Parameters<typeof renderMediaOnWeb>[0]);
    const blob = await result.getBlob();
    onProgress?.("uploading");
    const url = await uploadBlob(tenantId, blob, "mp4");
    return [url];
  }

  if (postType === "carousel") {
    const urls: string[] = [];
    const slides = props.slides.slice(0, 10);
    for (let i = 0; i < slides.length; i++) {
      onProgress?.(`rendering ${i + 1}/${slides.length}`);
      const blob = await renderStill(CarouselSlide as unknown as React.FC<Record<string, unknown>>, {
        ...(props as unknown as Record<string, unknown>),
        index: i,
      });
      urls.push(await uploadBlob(tenantId, blob, "jpg"));
    }
    return urls;
  }

  // image
  onProgress?.("rendering");
  const blob = await renderStill(PostCard as unknown as React.FC<Record<string, unknown>>, props as unknown as Record<string, unknown>);
  onProgress?.("uploading");
  return [await uploadBlob(tenantId, blob, "jpg")];
}
