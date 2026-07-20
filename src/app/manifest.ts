import type { MetadataRoute } from "next";

// PWA manifest: makes the CRM installable on iPad/phone home screens
// ("Aggiungi a schermata Home" / "Installa app") so it opens full-screen
// like a native app. Icons live in public/icons (generated from logo.png;
// the maskable ones sit on an opaque cream background for Android launchers).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BaliFlow CRM",
    short_name: "BaliFlow",
    description: "BaliFlow CRM - Business Operations Dashboard",
    // Stable identity: keeps the browser from treating a future start_url change
    // as a *different* app (which would prompt a duplicate install). Must equal
    // the resolved start_url path.
    id: "/",
    start_url: "/",
    // Matches the service worker scope (root) — keeps navigations in-app.
    scope: "/",
    display: "standalone",
    // No `orientation`: the app is used landscape on laptops and portrait on
    // tablets/phones, so we don't lock it either way.
    categories: ["business", "food", "productivity"],
    background_color: "#FCF6ED",
    theme_color: "#FCF6ED",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press / right-click deep links (Chrome/Edge/Android; iOS ignores).
    shortcuts: [
      {
        name: "BALI Flow",
        short_name: "BALI Flow",
        url: "/cassa",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Reservations",
        short_name: "Reservations",
        url: "/reservations",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
