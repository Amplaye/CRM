import { describe, it, expect, vi, afterEach } from "vitest";
import { publishToInstagram, publishToFacebook, waitForContainer } from "./meta-graph";

// A fetch stub whose behaviour is driven by a per-URL handler map. Each entry
// returns a Response; the default is a 200 { id }. We assert on fetchMock.calls.
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((u: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(u), init)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const noSleep = (_ms: number) => Promise.resolve();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publishToInstagram — image", () => {
  it("creates a container, waits FINISHED, then publishes", async () => {
    let step = 0;
    const fetchMock = stubFetch((url) => {
      if (url.includes("/media_publish")) {
        return new Response(JSON.stringify({ id: "IG_MEDIA_1" }), { status: 200 });
      }
      if (url.includes("status_code")) {
        return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      }
      // create container
      step++;
      return new Response(JSON.stringify({ id: "CONTAINER_1" }), { status: 200 });
    });

    const r = await publishToInstagram({
      igUserId: "IGUSER",
      token: "TOK",
      mediaType: "image",
      mediaUrls: ["https://pub/social-media/a.jpg"],
      caption: "hola",
      poll: { sleep: noSleep, intervalMs: 0 },
    });

    expect(r.ok).toBe(true);
    expect(r.igMediaId).toBe("IG_MEDIA_1");
    // create → poll → publish, all Bearer-authed to graph.facebook.com
    const first = fetchMock.mock.calls[0];
    expect(String(first[0])).toContain("graph.facebook.com/");
    expect(String(first[0])).toContain("IGUSER/media");
    const headers = (first[1]?.headers as Record<string, string>) || {};
    expect(headers.Authorization).toBe("Bearer TOK");
    expect(step).toBe(1);
  });
});

describe("publishToInstagram — reels sends media_type REELS + video_url", () => {
  it("posts a REELS container with the video url", async () => {
    const bodies: string[] = [];
    stubFetch((url, init) => {
      if (init?.body) bodies.push(String(init.body));
      if (url.includes("/media_publish")) return new Response(JSON.stringify({ id: "IG_REEL" }), { status: 200 });
      if (url.includes("status_code")) return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      return new Response(JSON.stringify({ id: "CONTAINER_REEL" }), { status: 200 });
    });

    const r = await publishToInstagram({
      igUserId: "IGUSER",
      token: "TOK",
      mediaType: "reels",
      mediaUrls: ["https://pub/social-media/reel.mp4"],
      caption: "reel!",
      poll: { sleep: noSleep, intervalMs: 0 },
    });

    expect(r.ok).toBe(true);
    expect(r.igMediaId).toBe("IG_REEL");
    const createBody = bodies.find((b) => b.includes("REELS")) || "";
    expect(createBody).toContain("media_type=REELS");
    expect(createBody).toContain("video_url");
  });
});

describe("publishToInstagram — carousel builds children then parent", () => {
  it("creates one child per url and a CAROUSEL parent", async () => {
    const bodies: string[] = [];
    let childCount = 0;
    stubFetch((url, init) => {
      if (init?.body) bodies.push(String(init.body));
      if (url.includes("/media_publish")) return new Response(JSON.stringify({ id: "IG_CAR" }), { status: 200 });
      if (url.includes("status_code")) return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      // container create — distinguish child vs parent by body
      const body = String(init?.body || "");
      if (body.includes("is_carousel_item")) {
        childCount++;
        return new Response(JSON.stringify({ id: `CHILD_${childCount}` }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "PARENT" }), { status: 200 });
    });

    const r = await publishToInstagram({
      igUserId: "IGUSER",
      token: "TOK",
      mediaType: "carousel",
      mediaUrls: ["https://pub/a.jpg", "https://pub/b.jpg"],
      caption: "set",
      poll: { sleep: noSleep, intervalMs: 0 },
    });

    expect(r.ok).toBe(true);
    expect(childCount).toBe(2);
    const parentBody = bodies.find((b) => b.includes("CAROUSEL")) || "";
    expect(parentBody).toContain("media_type=CAROUSEL");
    expect(parentBody).toContain("children");
  });
});

describe("waitForContainer", () => {
  it("returns ok on FINISHED", async () => {
    stubFetch(() => new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 }));
    const r = await waitForContainer("C1", "TOK", { sleep: noSleep, intervalMs: 0, maxTries: 3 });
    expect(r.ok).toBe(true);
  });

  it("fails on ERROR", async () => {
    stubFetch(() => new Response(JSON.stringify({ status_code: "ERROR" }), { status: 200 }));
    const r = await waitForContainer("C1", "TOK", { sleep: noSleep, intervalMs: 0, maxTries: 3 });
    expect(r.ok).toBe(false);
  });

  it("times out if never FINISHED", async () => {
    stubFetch(() => new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 }));
    const r = await waitForContainer("C1", "TOK", { sleep: noSleep, intervalMs: 0, maxTries: 2 });
    expect(r.ok).toBe(false);
  });
});

describe("never-throw contract", () => {
  it("returns ok:false status:0 on a network throw, not a rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const r = await publishToInstagram({
      igUserId: "IGUSER",
      token: "TOK",
      mediaType: "image",
      mediaUrls: ["https://pub/a.jpg"],
      caption: "x",
      poll: { sleep: noSleep, intervalMs: 0 },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
  });

  it("surfaces a Graph error message on non-2xx", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { message: "Invalid token" } }), { status: 401 }));
    const r = await publishToInstagram({
      igUserId: "IGUSER",
      token: "BAD",
      mediaType: "image",
      mediaUrls: ["https://pub/a.jpg"],
      caption: "x",
      poll: { sleep: noSleep, intervalMs: 0 },
    });
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toContain("Invalid token");
  });

  it("guards missing token / media", async () => {
    const noToken = await publishToInstagram({ igUserId: "X", token: "", mediaType: "image", mediaUrls: ["u"], caption: "" });
    expect(noToken.ok).toBe(false);
    const noMedia = await publishToInstagram({ igUserId: "X", token: "T", mediaType: "image", mediaUrls: [], caption: "" });
    expect(noMedia.ok).toBe(false);
  });
});

describe("publishToFacebook", () => {
  it("posts an image to /photos", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify({ id: "FB_PHOTO", post_id: "FB_POST" }), { status: 200 }));
    const r = await publishToFacebook({
      pageId: "PAGE",
      token: "TOK",
      mediaType: "image",
      mediaUrls: ["https://pub/a.jpg"],
      caption: "hi",
    });
    expect(r.ok).toBe(true);
    expect(r.fbPostId).toBe("FB_POST");
    expect(String(fetchMock.mock.calls[0][0])).toContain("PAGE/photos");
  });

  it("posts a reel to /videos", async () => {
    const fetchMock = stubFetch(() => new Response(JSON.stringify({ id: "FB_VIDEO" }), { status: 200 }));
    const r = await publishToFacebook({
      pageId: "PAGE",
      token: "TOK",
      mediaType: "reels",
      mediaUrls: ["https://pub/reel.mp4"],
      caption: "hi",
    });
    expect(r.ok).toBe(true);
    expect(r.fbPostId).toBe("FB_VIDEO");
    expect(String(fetchMock.mock.calls[0][0])).toContain("PAGE/videos");
  });
});
