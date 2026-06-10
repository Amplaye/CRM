import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Public review-link resolver.
//
// The post-dinner follow-up uses ONE approved Meta template whose dynamic URL
// button points at https://crm.baliflowagency.com/r/{slug}. This route 302s the
// guest to *that tenant's own* Google review link (settings.review_url), so a
// single template serves every tenant and each guest lands on the right page.
//
// No auth: it exposes nothing beyond the already-public Google page, and the
// review_url is owner-entered in Settings → Bookings (trusted). We still only
// honour http(s) URLs to avoid being turned into an open redirect to junk.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;

  const supabase = createServiceRoleClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, settings")
    .eq("slug", slug)
    .maybeSingle();

  const settings = (tenant?.settings ?? {}) as { review_url?: string };
  const url = (settings.review_url || "").trim();

  if (/^https?:\/\//i.test(url)) {
    return NextResponse.redirect(url, 302);
  }

  // No review link configured → never dead-end the click: send them to a Maps
  // search for the venue. (The follow-up motore should skip tenants without a
  // review_url, so in practice this is only hit on misconfiguration.)
  const q = encodeURIComponent(tenant?.name || "restaurant");
  return NextResponse.redirect(`https://www.google.com/maps/search/${q}`, 302);
}
