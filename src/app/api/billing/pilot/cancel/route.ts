import { NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { cancelPilotSubscription } from "@/lib/billing/pilot";

// POST /api/billing/pilot/cancel  — platform-admin only.
//
// Manual/internal cancellation: stops a pilot subscription IMMEDIATELY so the
// first subscription invoice (day 14) is never charged. (Customer-facing
// cancellation is by email to info@baliflowagency.com for now; this is the backend
// action that actually performs it.) The €150 pilot fee is non-refundable.
//
// Body: one of { stripe_subscription_id } | { stripe_customer_id } | { session_id }
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const result = await cancelPilotSubscription({
    subscriptionId: typeof body?.stripe_subscription_id === "string" ? body.stripe_subscription_id : undefined,
    customerId: typeof body?.stripe_customer_id === "string" ? body.stripe_customer_id : undefined,
    sessionId: typeof body?.session_id === "string" ? body.session_id : undefined,
  });

  if (!result.ok) {
    const status = result.error === "pilot_not_found" || result.error === "no_identifier" ? 404 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, canceled_subscription_id: result.subscriptionId });
}
