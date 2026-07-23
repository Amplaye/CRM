import { NextRequest, NextResponse } from "next/server";

// Server-side proxy for OpenStreetMap Nominatim address search.
//
// Nominatim blocks browser-origin requests (it returns HTTP 403 when a real
// `Origin`/`Referer` header is present), which is exactly what a fetch from the
// deployed CRM sends — so the onboarding address autocomplete silently stopped
// returning results. Calling it from the server instead has no browser Origin
// and lets us send the identifying `User-Agent` their usage policy requires.
//
// Public on purpose: the onboarding wizard runs before a tenant is fully set up,
// and this only forwards a free-text address query to a public geocoder. We cap
// the query length and pass nothing else through.

export const runtime = "nodejs";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Nominatim's policy wants an identifiable app + contact in the User-Agent.
const UA = "BaliFlowCRM/1.0 (https://app.baliflowagency.com)";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().slice(0, 200);
  if (q.length < 4) return NextResponse.json([]);

  const url =
    `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": req.headers.get("accept-language") || "en",
      },
      // Don't let a slow geocoder hang the request.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();
    // Trim to just the fields the client uses (display_name + address parts).
    const slim = Array.isArray(data)
      ? data.map((r: { display_name?: string; address?: Record<string, string> }) => ({
          display_name: r.display_name,
          address: r.address,
        }))
      : [];
    return NextResponse.json(slim, {
      // Cache identical lookups briefly at the edge to ease the rate limit.
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    });
  } catch {
    return NextResponse.json([]);
  }
}
