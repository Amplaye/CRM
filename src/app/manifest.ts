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
    start_url: "/",
    display: "standalone",
    background_color: "#FCF6ED",
    theme_color: "#FCF6ED",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
