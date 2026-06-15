import { NextResponse } from "next/server";
import { assertRateLimit } from "@/lib/rate-limit";
import { createPilotCheckout, pilotLandingHtml, resolvePilotLang } from "@/lib/billing/pilot";

// /api/billing/pilot/founder  →  the founder pilot.
//   GET  → a paste-anywhere landing page; localized via ?lang= / Accept-Language.
//   POST → "create-founder-pilot-checkout": returns the hosted Stripe Checkout url.
//          Charges €150 today, saves the card, then the webhook starts the 14-day
//          trial → €149 first month → €299/mo.
// Public sales endpoint (the buyer has no account yet) — rate-limited by IP.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return new Response(pilotLandingHtml("founder", resolvePilotLang(req)), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const rl = await assertRateLimit(req, "pilot:founder", { max: 10, windowSecs: 60 });
  if (rl) return rl;

  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://crm.baliflowagency.com";
  const result = await createPilotCheckout("founder", origin, resolvePilotLang(req));
  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status });
  }
  return NextResponse.json({ ok: true, url: result.url, session_id: result.sessionId });
}
