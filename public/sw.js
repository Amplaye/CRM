// Minimal service worker: exists only to satisfy the PWA installability
// criteria on Chrome/Edge/Firefox/Android (they require a registered SW with
// a fetch handler before showing "Install app"). Safari/iOS installs via
// "Add to Home Screen" without needing this at all.
//
// Deliberately no caching: this is a multi-tenant CRM with live, sensitive
// data — an offline cache could serve stale or cross-tenant-stale content.
// Every request just passes through to the network untouched.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op: let the browser handle the request normally.
});
