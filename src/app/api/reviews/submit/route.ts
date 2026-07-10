import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyReviewToken } from "@/lib/reviews/token";
import { getFeatures } from "@/lib/types/tenant-settings";
import { assertRateLimit } from "@/lib/rate-limit";
import { sendPushToTenant } from "@/lib/push/send";

// Public review submission — auth is the signed token (see reviews/token.ts),
// not a session. Upsert on reservation_id: re-submitting edits the same
// review, so a guest can fix a typo and the table never collects duplicates.

export async function POST(req: Request) {
  const limited = await assertRateLimit(req, "reviews_submit", { windowSecs: 3600, max: 20 });
  if (limited) return limited;

  try {
    const body = await req.json();
    const payload = verifyReviewToken(String(body.token || ""));
    if (!payload) return NextResponse.json({ error: "invalid_token" }, { status: 403 });

    const rating = Math.round(Number(body.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
    }
    const comment = String(body.comment || "").slice(0, 2000).trim();

    const svc = createServiceRoleClient();
    const { data: tenant } = await svc
      .from("tenants")
      .select("id, settings")
      .eq("slug", payload.s)
      .maybeSingle();
    if (!tenant || !getFeatures(tenant.settings).reviews_enabled) {
      return NextResponse.json({ error: "not_available" }, { status: 404 });
    }
    const { data: reservation } = await svc
      .from("reservations")
      .select("id, guest_id, guests(name)")
      .eq("id", payload.r)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (!reservation) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { data: existing } = await svc
      .from("reviews")
      .select("id")
      .eq("reservation_id", reservation.id)
      .maybeSingle();

    if (existing) {
      await svc
        .from("reviews")
        .update({ rating, comment, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      const { error } = await svc.from("reviews").insert({
        tenant_id: tenant.id,
        reservation_id: reservation.id,
        guest_id: reservation.guest_id,
        rating,
        comment,
        source: "guest",
      });
      if (error) throw error;
      const guestName = (reservation.guests as { name?: string | null } | null)?.name || "";
      void sendPushToTenant(tenant.id, "review_new", {
        stars: "★".repeat(rating) + "☆".repeat(5 - rating),
        name: guestName,
      });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[reviews/submit]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
