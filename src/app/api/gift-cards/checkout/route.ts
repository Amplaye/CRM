import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createGiftCardCheckoutSession, stripeConfigured } from "@/lib/billing/stripe";
import { getFeatures } from "@/lib/types/tenant-settings";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { isValidGiftAmount, formatGiftCents } from "@/lib/gift-cards/gift-cards";
import { findGiftDesign, publishedGiftDesigns } from "@/lib/gift-cards/designs";
import { assertRateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-error";

// PUBLIC endpoint behind the /g/<slug> purchase form — no auth (the buyer is
// a guest), so: rate-limited by IP, tenant resolved by slug and double-gated
// (active plan + gift_cards_enabled), amount validated server-side against
// the same bounds the form shows. Nothing is written here: the voucher is
// born ONLY in the Stripe webhook after real money moved.
//
// When the owner has designed cards, the buyer sends a `design_id` and the
// PRICE COMES FROM THE STORED DESIGN, never from the request — otherwise a
// crafted body could buy the €200 card for €10.

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const limited = await assertRateLimit(req, "gift:checkout", { max: 10, windowSecs: 60 });
  if (limited) return limited;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const designId = typeof body?.design_id === "string" ? body.design_id.trim() : "";
  const requestedCents = Number(body?.amount_cents);
  const buyerName = typeof body?.buyer_name === "string" ? body.buyer_name.trim().slice(0, 80) : "";
  const buyerEmail = typeof body?.buyer_email === "string" ? body.buyer_email.trim() : "";
  const recipientEmail = typeof body?.recipient_email === "string" ? body.recipient_email.trim() : "";
  const recipientName = typeof body?.recipient_name === "string" ? body.recipient_name.trim().slice(0, 80) : "";
  // Stripe metadata values cap at 500 chars — clamp the gift message well under.
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 280) : "";

  // With a design the amount is authoritative server-side, so only the FALLBACK
  // (free-amount) path validates the number the browser sent.
  if (!slug || (!designId && !isValidGiftAmount(requestedCents))) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!EMAIL_RE.test(buyerEmail) || (recipientEmail && !EMAIL_RE.test(recipientEmail))) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });
  }

  const svc = createServiceRoleClient();
  const { data: tenant } = await svc
    .from("tenants")
    .select("id, name, slug, status, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || (tenant.status !== "trial" && tenant.status !== "active")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!hasActivePlan(tenant.settings) || !getFeatures(tenant.settings).gift_cards_enabled) {
    return NextResponse.json({ error: "not_available" }, { status: 403 });
  }

  const designs = publishedGiftDesigns(tenant.settings?.gift_designs);
  const design = findGiftDesign(designs, designId);
  // Asked for a card that isn't on sale (deleted, hidden, or a stale tab): refuse
  // rather than silently falling back to a free amount the owner didn't offer.
  if (designId && !design) {
    return NextResponse.json({ error: "design_not_available" }, { status: 409 });
  }
  // Once the owner publishes cards, the free-amount path is closed — the page
  // stops offering it, so a request without a design_id is not a buyer.
  if (!design && designs.length > 0) {
    return NextResponse.json({ error: "design_required" }, { status: 400 });
  }
  const amountCents = design ? design.amount_cents : requestedCents;

  const currency = String(tenant.settings?.currency || "EUR");
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://app.baliflowagency.com";
  const locale = typeof tenant.settings?.crm_locale === "string" ? tenant.settings.crm_locale : undefined;

  try {
    const session = await createGiftCardCheckoutSession({
      amountCents,
      currency,
      productName: design
        ? `${design.title} — ${tenant.name}`
        : `Gift card ${formatGiftCents(amountCents, currency)} — ${tenant.name}`,
      successUrl: `${origin}/g/${tenant.slug}?paid=1`,
      cancelUrl: `${origin}/g/${tenant.slug}?paid=0`,
      clientReferenceId: tenant.id,
      metadata: {
        kind: "gift_card",
        tenant_id: tenant.id,
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        message,
        // Snapshotted onto the voucher so redesigning the card later never
        // rewrites what an already-sold voucher says.
        design_id: design?.id ?? "",
        design_title: design?.title ?? "",
      },
      customerEmail: buyerEmail,
      locale,
    });
    return NextResponse.json({ url: session.url });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    return apiError(e, { route: "gift-cards/checkout", publicMessage: "stripe_error", status: 502 });
  }
}
