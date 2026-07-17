// Publishing primitives for the Social section via the Meta Graph API — the
// twin of whatsapp/meta.ts, specialised for Instagram + Facebook content.
//
// Every function follows the same never-throw → result-object contract as
// sendWhatsAppMeta: guard missing inputs, fetch, parse-with-catch, non-2xx →
// { ok:false, ... }, thrown/network error → { ok:false, status:0 }. The cron
// inspects the result and moves the post to published/failed accordingly.
//
// Instagram publishing is a 3-step container flow (Meta downloads the media by
// URL, so media_urls must be PUBLIC — the social-media bucket):
//   1. POST /{ig-user-id}/media           → creation_id (container)
//   2. GET  /{container-id}?fields=status_code   poll until FINISHED (reels encode)
//   3. POST /{ig-user-id}/media_publish   → ig_media_id
// A carousel adds N child containers (is_carousel_item=true) wrapped in a parent
// CAROUSEL container.
//
// Facebook is simpler: POST /{page-id}/photos (image) or /{page-id}/videos (reel).

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type SocialMediaType = "image" | "carousel" | "reels";

export interface PublishResult {
  ok: boolean;
  /** Instagram media id on IG success. */
  igMediaId?: string;
  /** Facebook post/photo/video id on FB success. */
  fbPostId?: string;
  /** HTTP status from Graph (or 0 on a thrown/network error). */
  status: number;
  /** Parsed Graph error payload on failure, for logging. */
  error?: unknown;
  /** Human-readable error message on failure. */
  errorMessage?: string;
}

interface GraphResult<T> {
  ok: boolean;
  status: number;
  data: T;
  error?: unknown;
  errorMessage?: string;
}

/** One POST to the Graph API with Bearer auth, parsed and never-throwing. */
async function graphPost<T = Record<string, unknown>>(
  path: string,
  token: string,
  body: Record<string, string | boolean>,
): Promise<GraphResult<T>> {
  try {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) form.set(k, String(v));
    const res = await fetch(`${GRAPH}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: data, errorMessage: data?.error?.message || `Graph error ${res.status}` };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: {} as T, errorMessage: e instanceof Error ? e.message : String(e) };
  }
}

/** One GET to the Graph API with Bearer auth, parsed and never-throwing. */
async function graphGet<T = Record<string, unknown>>(path: string, token: string): Promise<GraphResult<T>> {
  try {
    const res = await fetch(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: data, errorMessage: data?.error?.message || `Graph error ${res.status}` };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: {} as T, errorMessage: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Poll an IG media container until it finishes processing. Reels encode on
 * Meta's side, so a just-created container is IN_PROGRESS until FINISHED.
 * `sleep`/`now` are injectable so tests run instantly without real timers.
 */
export async function waitForContainer(
  containerId: string,
  token: string,
  opts?: { maxTries?: number; sleep?: (ms: number) => Promise<void>; intervalMs?: number },
): Promise<{ ok: boolean; status?: string; errorMessage?: string }> {
  const maxTries = opts?.maxTries ?? 5;
  const intervalMs = opts?.intervalMs ?? 60_000;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < maxTries; i++) {
    const r = await graphGet<{ status_code?: string }>(`${containerId}?fields=status_code`, token);
    if (!r.ok) return { ok: false, errorMessage: r.errorMessage };
    const code = r.data?.status_code;
    if (code === "FINISHED") return { ok: true, status: code };
    if (code === "ERROR" || code === "EXPIRED") return { ok: false, status: code, errorMessage: `Container ${code}` };
    if (i < maxTries - 1) await sleep(intervalMs);
  }
  return { ok: false, errorMessage: "Container did not finish in time" };
}

export interface PublishToInstagramInput {
  igUserId: string;
  token: string;
  mediaType: SocialMediaType;
  /** Public URLs (image jpg / video mp4) in the social-media bucket. */
  mediaUrls: string[];
  caption: string;
  /** Injectable poll controls for tests. */
  poll?: { maxTries?: number; sleep?: (ms: number) => Promise<void>; intervalMs?: number };
}

/**
 * Publish to Instagram via the container flow. Handles image, reels and carousel.
 * Never throws — returns a PublishResult.
 */
export async function publishToInstagram(input: PublishToInstagramInput): Promise<PublishResult> {
  const { igUserId, token, mediaType, mediaUrls, caption } = input;
  if (!token) return { ok: false, status: 0, errorMessage: "Missing Page access token" };
  if (!igUserId) return { ok: false, status: 0, errorMessage: "Missing Instagram account id" };
  if (!mediaUrls.length) return { ok: false, status: 0, errorMessage: "No media to publish" };

  // Step 1 — create the container(s).
  let creationId: string | undefined;

  if (mediaType === "carousel") {
    // One child container per item, then a parent CAROUSEL container.
    const childIds: string[] = [];
    for (const url of mediaUrls) {
      const child = await graphPost<{ id?: string }>(`${igUserId}/media`, token, {
        image_url: url,
        is_carousel_item: true,
      });
      if (!child.ok || !child.data?.id) return { ok: false, status: child.status, error: child.error, errorMessage: child.errorMessage || "Carousel child failed" };
      childIds.push(child.data.id);
    }
    const parent = await graphPost<{ id?: string }>(`${igUserId}/media`, token, {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
    });
    if (!parent.ok || !parent.data?.id) return { ok: false, status: parent.status, error: parent.error, errorMessage: parent.errorMessage || "Carousel parent failed" };
    creationId = parent.data.id;
  } else if (mediaType === "reels") {
    const c = await graphPost<{ id?: string }>(`${igUserId}/media`, token, {
      media_type: "REELS",
      video_url: mediaUrls[0],
      caption,
    });
    if (!c.ok || !c.data?.id) return { ok: false, status: c.status, error: c.error, errorMessage: c.errorMessage || "Reel container failed" };
    creationId = c.data.id;
  } else {
    // image
    const c = await graphPost<{ id?: string }>(`${igUserId}/media`, token, {
      image_url: mediaUrls[0],
      caption,
    });
    if (!c.ok || !c.data?.id) return { ok: false, status: c.status, error: c.error, errorMessage: c.errorMessage || "Image container failed" };
    creationId = c.data.id;
  }

  // Step 2 — wait for the container to finish (mainly for reels/carousel encoding).
  const ready = await waitForContainer(creationId, token, input.poll);
  if (!ready.ok) return { ok: false, status: 0, errorMessage: ready.errorMessage };

  // Step 3 — publish.
  const pub = await graphPost<{ id?: string }>(`${igUserId}/media_publish`, token, { creation_id: creationId });
  if (!pub.ok || !pub.data?.id) return { ok: false, status: pub.status, error: pub.error, errorMessage: pub.errorMessage || "Publish failed" };
  return { ok: true, status: pub.status, igMediaId: pub.data.id };
}

export interface PublishToFacebookInput {
  pageId: string;
  token: string;
  mediaType: SocialMediaType;
  mediaUrls: string[];
  caption: string;
}

/**
 * Publish to a Facebook Page. Image → /photos, reels → /videos. A carousel is
 * published as its first photo with the caption (FB has no native carousel via
 * this endpoint), which keeps the never-throw contract simple. Never throws.
 */
export async function publishToFacebook(input: PublishToFacebookInput): Promise<PublishResult> {
  const { pageId, token, mediaType, mediaUrls, caption } = input;
  if (!token) return { ok: false, status: 0, errorMessage: "Missing Page access token" };
  if (!pageId) return { ok: false, status: 0, errorMessage: "Missing Facebook Page id" };
  if (!mediaUrls.length) return { ok: false, status: 0, errorMessage: "No media to publish" };

  if (mediaType === "reels") {
    const r = await graphPost<{ id?: string }>(`${pageId}/videos`, token, {
      file_url: mediaUrls[0],
      description: caption,
    });
    if (!r.ok || !r.data?.id) return { ok: false, status: r.status, error: r.error, errorMessage: r.errorMessage || "FB video failed" };
    return { ok: true, status: r.status, fbPostId: r.data.id };
  }
  // image or carousel → post the first photo with the caption.
  const r = await graphPost<{ id?: string; post_id?: string }>(`${pageId}/photos`, token, {
    url: mediaUrls[0],
    caption,
  });
  if (!r.ok || !(r.data?.id || r.data?.post_id)) return { ok: false, status: r.status, error: r.error, errorMessage: r.errorMessage || "FB photo failed" };
  return { ok: true, status: r.status, fbPostId: r.data.post_id || r.data.id };
}
