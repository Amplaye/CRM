import { NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/admin-auth";
import { getBillingRows } from "@/lib/billing/admin-overview";

/** Cross-tenant list of every subscription + pilot, normalized into one shape.
 * READ-ONLY (no Stripe calls); money actions deep-link to the Stripe dashboard. */
export async function GET() {
  const auth = await assertPlatformAdmin();
  if (!auth.ok) return auth.res;
  try {
    const rows = await getBillingRows();
    return NextResponse.json({ rows });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed" }, { status: 500 });
  }
}
