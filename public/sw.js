// BaliFlow CRM service worker — app-shell caching for a fast, offline-capable PWA.
//
// ⚠️ SAFETY CONTRACT — READ BEFORE EDITING ⚠️
// This is a MULTI-TENANT CRM with live, fiscal, money data. The cache must never
// serve stale or cross-tenant content. The rules below are load-bearing:
//
//   1. NEVER intercept cross-origin requests (Supabase REST + wss, Vapi, Graph).
//      They carry live/sensitive/cross-tenant data — they must always hit the
//      network. (If Supabase is ever proxied through a same-origin /api route,
//      this SW MUST be revisited — rule 2 would start caching live data.)
//   2. NEVER intercept same-origin /api/* — those are the server-authoritative
//      writes/reads incl. fiscal receipt numbering. Always network or fail.
//   3. HTML/navigation responses are network-first and a cached copy is served
//      ONLY when the network is unreachable (offline fallback). While online a
//      user ALWAYS gets fresh HTML — the past "users can't see their changes"
//      staleness bug cannot recur because the cache is never consulted on a
//      successful fetch. Cached pages are purged on logout and tenant switch
//      (see purgeOfflinePages in src/lib/offline-cache.ts). Never-visited
//      routes fall back to the generic /offline.html.
//   4. Only content-hashed build assets (/_next/static/*) are cache-first —
//      safe because a new build changes the filename, so the URL misses the old
//      cache and refetches. Everything else that IS cached is same-origin static
//      (icons, manifest) via stale-while-revalidate.
//
// Because live data is NEVER served from this SW, an online user always gets
// fresh data straight from Supabase — the past staleness incident cannot recur.

// Bump ONLY when this SW's logic changes. Normal app deploys don't need a bump:
// their /_next/static/* URLs are already content-hashed, so old assets fall out
// of use naturally and the activate handler purges the previous version's cache.
const CACHE_VERSION = "v2";
const STATIC_CACHE = `bf-static-${CACHE_VERSION}`;
const SHELL_CACHE = `bf-shell-${CACHE_VERSION}`;
// Route HTML for offline fallback ONLY. Kept separate from SHELL_CACHE so the
// page (offline-cache.ts) can purge it on logout/tenant switch without touching
// the offline page or icons. The "bf-pages-" prefix is a contract with
// purgeOfflinePages() — rename both together.
const PAGES_CACHE = `bf-pages-${CACHE_VERSION}`;

const OFFLINE_URL = "/offline.html";

// Minimal, build-independent precache: the offline fallback + install chrome.
// Deliberately does NOT include "/" or any route HTML (they reference hashed
// scripts we can't name here → staleness trap) nor /_next/static/* chunks
// (their hashed names change every build → they're runtime-cached instead).
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Best-effort: a single failed precache URL shouldn't abort activation.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {}),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Delete every cache that isn't part of the current version. A version
      // bump therefore purges all old assets — no stale strategy can linger.
      const keep = new Set([STATIC_CACHE, SHELL_CACHE, PAGES_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// The page (ServiceWorkerRegister) tells us when the user has accepted an update.
// We never call skipWaiting on our own for an *update* — the page decides, so a
// POS is never reloaded mid-transaction.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isStaticAsset(url) {
  if (url.pathname.startsWith("/icons/")) return true;
  if (url.pathname === "/manifest.webmanifest") return true;
  return /\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/.test(url.pathname);
}

// Network-first for navigations: always try fresh HTML. A good response is
// copied into PAGES_CACHE so the SAME route can be reopened offline later.
// The cache is consulted ONLY when the network fails — an online user can
// never be served a stale page. Auth redirects (307 → login) surface to the
// SW as non-ok/opaqueredirect responses and are never cached, so a logged-out
// response can't poison the cache under a dashboard URL.
async function networkFirstNav(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok && !response.redirected) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        const cache = await caches.open(PAGES_CACHE);
        // ignoreSearch on read (below) pairs with stripping the search here,
        // so /reservations?date=… and /reservations share one cached shell —
        // all dashboard pages are client components that refetch their own
        // data, the HTML shell is the same.
        const url = new URL(request.url);
        url.search = "";
        cache.put(url.toString(), response.clone()).catch(() => {});
      }
    }
    return response;
  } catch {
    const pages = await caches.open(PAGES_CACHE);
    const url = new URL(request.url);
    url.search = "";
    const cachedPage = await pages.match(url.toString());
    if (cachedPage) return cachedPage;
    const cache = await caches.open(SHELL_CACHE);
    const fallback = await cache.match(OFFLINE_URL);
    return (
      fallback ||
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      })
    );
  }
}

// Cache-first for immutable hashed assets: serve from cache, else fetch & store.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.status === 200) {
    cache.put(request, response.clone());
  }
  return response;
}

// Stale-while-revalidate for small same-origin static (icons/manifest): serve
// cache immediately if present, refresh in the background.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetching = fetch(request)
    .then((response) => {
      if (response && response.ok && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetching;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 0. Only GET is ever cacheable. Mutations (POST/PUT/PATCH/DELETE) pass through.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 1. Cross-origin (Supabase REST/wss, Vapi, Graph, …) → never touched.
  if (url.origin !== self.location.origin) return;

  // 2. Same-origin API (fiscal money path, receipt numbering) → never touched.
  if (url.pathname.startsWith("/api/")) return;

  // 3. Navigations (HTML documents) → network-first, offline.html fallback.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNav(request));
    return;
  }

  // 4. Content-hashed build assets → cache-first (immutable per build).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 5. Icons / manifest / same-origin images/fonts → stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // 6. Everything else → default network passthrough (do nothing).
});
