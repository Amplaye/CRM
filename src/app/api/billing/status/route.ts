import { NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import { getSubscription } from "@/lib/billing/state";
import { stripeConfigured } from "@/lib/billing/stripe";
import { paypalConfigured } from "@/lib/billing/paypal";

// Read the current subscription for a tenant (Settings → Payments). Also reports
// which providers are configured so the UI can disable a "Pay with X" button with
// a "coming soon" note instead of letting the owner hit a 503.
//
// Body: { tenant_id }
export async function POST(req: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const tenantId: string | undefined = body?.tenant_id;
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }

  const subscription = await getSubscription(tenantId);
  return NextResponse.json({
    ok: true,
    subscription,
    providers: { stripe: stripeConfigured(), paypal: paypalConfigured() },
  });
}
