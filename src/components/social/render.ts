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

// Remotion web-renderer options shared by every render call:
// - licenseKey "free-license": Remotion's Free License covers small teams — no
//   account, no API key, it's a compliance string, not a service. Passing it
//   silences the "Pass licenseKey…" console warning (https://remotion.dev/license).
// - logLevel "error": Chromium's getComputedStyle reports font-stretch as "100%",
//   which the Canvas fontStretch API rejects, so Remotion warns once per text span
//   (a harmless no-op). Raising the threshold stops the console flood; our own
//   fontStretch is already "normal", the "100%" comes from the browser, not us.
const RENDER_OPTS = { licenseKey: "free-license", logLevel: "error" } as const;

// Two browser quirks make Remotion's web render noisy in Chromium. We neutralise
// both for the duration of the render only, restoring the globals in `finally`.
//
// 1. Telemetry: Remotion POSTs a usage-tracking ping to remotion.pro on every
//    render. It's pure telemetry — getBlob() succeeds even when it fails — and our
//    CSP (connect-src) intentionally does NOT allowlist that host, so the browser
//    logs a red "Refused to connect" CSP error. We short-circuit exactly that one
//    request with a fake OK (Remotion then neither retries nor warns).
//
// 2. fontStretch: Remotion reads font-stretch via getComputedStyle and assigns it
//    to CanvasRenderingContext2D.fontStretch. Chromium computes font-stretch as
//    "100%", but the Canvas API only accepts keywords, so the *browser* logs
//    "'100%' is not a valid enum value of type CanvasFontStretch" once per text
//    span (Remotion's logLevel can't silence it — it's not Remotion's log). We
//    override the canvas fontStretch setter so a percentage value lands as the
//    equivalent keyword ("100%" → "normal") instead of being rejected. Targeting
//    the setter (not getComputedStyle) avoids proxying the host CSSStyleDeclaration,
//    which breaks native accessors in WebKit/Firefox.
const TELEMETRY_HOST = "remotion.pro";
type Ctx2DCtor = { prototype: CanvasRenderingContext2D } | undefined;
async function withRenderShims<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined") return fn();

  const realFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(TELEMETRY_HOST)) {
      return Promise.resolve(new Response(JSON.stringify({ success: true, billable: false }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return realFetch(input, init);
  }) as typeof window.fetch;

  // Patch fontStretch on both the visible and offscreen canvas contexts (Remotion
  // renders on an OffscreenCanvas). Restored via the returned undo fns.
  const undos: Array<() => void> = [];
  for (const Ctor of [
    (window as unknown as { CanvasRenderingContext2D?: Ctx2DCtor }).CanvasRenderingContext2D,
    (window as unknown as { OffscreenCanvasRenderingContext2D?: Ctx2DCtor }).OffscreenCanvasRenderingContext2D,
  ]) {
    const proto = Ctor?.prototype as (CanvasRenderingContext2D & { fontStretch?: string }) | undefined;
    const desc = proto ? Object.getOwnPropertyDescriptor(proto, "fontStretch") : undefined;
    if (!proto || !desc?.set || !desc.get) continue;
    const realSet = desc.set;
    Object.defineProperty(proto, "fontStretch", {
      ...desc,
      set(this: CanvasRenderingContext2D, v: string) {
        realSet.call(this, typeof v === "string" && v.includes("%") ? "normal" : v);
      },
    });
    undos.push(() => Object.defineProperty(proto, "fontStretch", desc));
  }

  try {
    return await fn();
  } finally {
    window.fetch = realFetch;
    for (const undo of undos) undo();
  }
}

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
    ...RENDER_OPTS,
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
 * shows the message. Remotion's telemetry ping and Chromium's fontStretch warning
 * are neutralised for the duration (see withRenderShims); uploads pass through.
 */
export function renderAndUpload(req: RenderRequest): Promise<string[]> {
  return withRenderShims(() => renderAndUploadInner(req));
}

async function renderAndUploadInner(req: RenderRequest): Promise<string[]> {
  const { tenantId, postType, props, onProgress } = req;

  if (postType === "reels") {
    if (!isVideoRenderSupported()) throw new Error("reel_unsupported_browser");
    onProgress?.("rendering");
    const slides = props.slides.length ? props.slides : [{ name: props.restaurantName }];
    const { width, height } = SOCIAL_DIMENSIONS.reels;
    const durationInFrames = slides.length * REEL_SECONDS_PER_SLIDE * REEL_FPS;
    const result = await renderMediaOnWeb({
      ...RENDER_OPTS,
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
