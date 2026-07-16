import type { NextConfig } from "next";

// Content-Security-Policy. Pragmatic for a Next.js + Supabase app: scripts and
// styles are restricted to self/inline (Next injects inline hydration scripts
// and Tailwind injects inline styles), connect is limited to self + Supabase +
// the AI/Vapi backends we actually call, framing is denied, and form/base/
// object are locked down. No 'unsafe-eval': src/ contains no dynamic code
// evaluation and Next 16 production bundles don't need it. Tightening
// script-src to a nonce would force dynamic rendering on the static public
// pages (/s, /b, /g) — deliberately NOT done; 'unsafe-inline' stays for
// Next's hydration scripts.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.vapi.ai https://graph.facebook.com https://api.resend.com",
  // The public micro-site (/s) embeds a Google Maps iframe. Without an explicit
  // frame-src it falls back to default-src 'self' and the map is blocked by our
  // own CSP (renders as a broken frame). Allow only Google's map hosts — plus
  // 'self', which also covers the srcdoc iframe the Floor QR sheet uses to print
  // (a srcdoc frame is matched against frame-src as the parent origin; without
  // 'self' Brave/strict browsers block it and the Print button does nothing).
  "frame-src 'self' https://www.google.com https://maps.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The service worker must never be served stale, or users get stuck on
        // an old SW after a deploy. no-store forces the browser to revalidate
        // /sw.js over the network (paired with updateViaCache:'none' at
        // registration). Both rules match /sw.js and set different header keys,
        // so this composes with the security headers below without conflict.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
