import { NextResponse } from "next/server";
import { assertRateLimit } from "@/lib/rate-limit";
import { createPilotCheckout } from "@/lib/billing/pilot";

// POST /api/billing/pilot/founder  →  "create-founder-pilot-checkout"
//
// Public sales endpoint (the buyer has no account yet) — rate-limited by IP.
// Returns the hosted Stripe Checkout url. Charges €150 today, saves the card, and
// the webhook then starts the 14-day trial → €149 first month → €299/mo.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = await assertRateLimit(req, "pilot:founder", { max: 10, windowSecs: 60 });
  if (rl) return rl;

  const origin = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://crm.baliflowagency.com";
  const result = await createPilotCheckout("founder", origin);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status });
  }
  return NextResponse.json({ ok: true, url: result.url, session_id: result.sessionId });
}
