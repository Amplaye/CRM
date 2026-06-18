import { NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { getBillingRows, summarize } from "@/lib/billing/admin-overview";

/** Top-of-page billing totals (MRR/ARR, trials ending, past_due, churn) for the
 * Fleet strip and the Billing console. Same row set as the subscriptions route. */
export async function GET() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const rows = await getBillingRows();
    return NextResponse.json(summarize(rows));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed" }, { status: 500 });
  }
}
