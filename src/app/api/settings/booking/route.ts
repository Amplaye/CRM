import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { getFeatures } from "@/lib/types/tenant-settings";
import {
  reservationArticleFromForm,
  detectArticleLangs,
  RESERVATION_TITLES,
  type CancellationNotice,
  type Lang,
  type OpeningHours,
} from "@/lib/onboarding/kb-generator";
// Save the post-onboarding booking settings (Settings → Bookings).
//
// HONESTY RULE: we only write values something actually READS at runtime —
//   - owner_phone        → settings.owner_phone + bot_config.responsible_phone
//                          (the shared motore + every auxiliary workflow read
//                           responsible_phone LIVE → owner notifications go to
//                           the new number)
//   - restaurant_phone   → settings.restaurant_phone (read LIVE by the auxiliary
//                          workflows' config loader)
//   - review_url         → settings.review_url (read LIVE by the post-dinner
//                          follow-up workflow)
//   - cancellation/deposit → settings.venue.* (read LIVE by /api/ai/book recap)
//   - last-reservation offsets → settings.last_reservation_offset (read LIVE by
//                          /api/ai/availability) + bot_config.closing_time_offset_min
//                          (the motore's last-booking-before-closing gate)
//   - late tolerance     → bot_config + quoted from the reservation KB article
// and then we REGENERATE the reservation KB article so the policy the bot QUOTES
// matches the policy it ENFORCES.
//
// LIVE CONTACTS (2026-06-03): the three contacts are no longer baked into the
// cloned n8n workflows — they read them LIVE from the DB at runtime — so writing
// the settings here is all it takes for the reminders / daily-summary / post-
// dinner / pre-shift / audit flows to pick up the new value on their next run.
// No workflow re-sync needed (the old resyncTenantWorkflows patch was removed).

const CANCELLATION_VALUES: CancellationNotice[] = ["none", "same_day", "2h", "24h"];

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

export async function POST(req: NextRequest) {
  // Dashboard-only: a signed-in owner/manager of this tenant.
  try {
    const session = await createServerSupabaseClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const tenant_id: string = body?.tenant_id;
    if (!tenant_id) return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 });

    const member = await verifyTenantMembership(tenant_id, ["owner", "manager"]);
    if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const supabase = createServiceRoleClient();
    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("id, name, settings")
      .eq("id", tenant_id)
      .single();
    if (tErr || !tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const settings = ((tenant.settings as Record<string, any>) || {});

    // --- sanitize inputs ---
    const ownerPhone = String(body.owner_phone ?? settings.owner_phone ?? "").trim();
    const restaurantPhone = String(body.restaurant_phone ?? settings.restaurant_phone ?? "").trim();
    const reviewUrl = String(body.review_url ?? settings.review_url ?? "").trim();
    const cancellation: CancellationNotice = CANCELLATION_VALUES.includes(body.cancellation_notice)
      ? body.cancellation_notice
      : "none";
    const lateTol = clampInt(body.late_tolerance_min, 0, 240, 15);
    const lateGrace = !!body.late_grace_if_notified;
    const lunchOff = clampInt(body.last_lunch_offset_min, -1, 240, 45);
    const dinnerOff = clampInt(body.last_dinner_offset_min, -1, 240, 60);
    const depositRequired = !!body.deposit_required;
    const depositAmount = String(body.deposit_amount ?? "").trim();

    // Closing-time gate uses ONE offset: the stricter (larger) of the served
    // shifts; a shift switched off (-1) is ignored. Mirrors botConfigFromQuestionnaire.
    const servedOffsets = [lunchOff, dinnerOff].filter((n) => n >= 0);
    const closingOffset = servedOffsets.length ? Math.max(...servedOffsets) : 45;

    const newSettings = {
      ...settings,
      owner_phone: ownerPhone,
      restaurant_phone: restaurantPhone,
      review_url: reviewUrl,
      last_reservation_offset: { lunch: lunchOff, dinner: dinnerOff },
      venue: {
        ...(settings.venue || {}),
        deposit_required: depositRequired,
        deposit_amount: depositAmount,
        cancellation_notice: cancellation,
      },
      bot_config: {
        ...(settings.bot_config || {}),
        responsible_phone: ownerPhone,
        closing_time_offset_min: closingOffset,
        late_tolerance_min: lateTol,
        late_grace_if_notified: lateGrace,
      },
    };

    const { error: upErr } = await supabase
      .from("tenants")
      .update({ settings: newSettings })
      .eq("id", tenant_id);
    if (upErr) throw upErr;

    // --- regenerate the reservation-policy KB article (language-aware) ---
    // Best-effort: a settings save must succeed even if the KB write hiccups.
    let kb: "updated" | "inserted" | "skipped" = "skipped";
    try {
      const primaryRaw = settings.bot_config?.primary_language;
      const primary: Lang = (["es", "it", "en", "de"] as const).includes(primaryRaw) ? primaryRaw : "es";

      const { data: existingRows } = await supabase
        .from("knowledge_articles")
        .select("id, title, content")
        .eq("tenant_id", tenant_id)
        .in("title", RESERVATION_TITLES as string[]);
      const row = (existingRows || [])[0] as { id: string; title: string; content: string } | undefined;

      const langs = row?.content ? detectArticleLangs(row.content, primary) : [primary];

      // Capacity comes from the LIVE floor plan (the owner edits tables there), not
      // a frozen onboarding number; 0 → the capacity line is simply omitted.
      const { data: tables } = await supabase
        .from("restaurant_tables")
        .select("seats")
        .eq("tenant_id", tenant_id);
      const capacity = (tables || []).reduce((s: number, t: { seats?: number }) => s + (Number(t.seats) || 0), 0);

      const features = getFeatures(settings as any);
      const large = Number(settings.bot_config?.party_size_threshold_large);
      const autoConfirmMax = Number.isFinite(large) && large > 0 ? large - 1 : 6;
      const block = Number(settings.bot_config?.party_size_block_threshold);
      // Accepts large groups when there's headroom above the manual-review line;
      // else fall back to the events feature flag.
      const acceptsLarge = Number.isFinite(block) && Number.isFinite(large)
        ? block > large
        : !!features.events_enabled;

      const article = reservationArticleFromForm(
        {
          cancellation_notice: cancellation,
          late_tolerance_min: lateTol,
          late_grace_if_notified: lateGrace,
          last_lunch_offset_min: lunchOff,
          last_dinner_offset_min: dinnerOff,
          deposit_required: depositRequired,
          deposit_amount: depositAmount,
        },
        {
          restaurant_name: tenant.name,
          restaurant_phone: restaurantPhone,
          opening_hours: (settings.opening_hours as OpeningHours) || undefined,
          languages: langs,
          capacity_seats: capacity,
          auto_confirm_max: autoConfirmMax,
          accepts_large_groups: acceptsLarge,
          terrace: !!features.terrace,
        },
      );

      if (row?.id) {
        await supabase
          .from("knowledge_articles")
          .update({ content: article.content, status: "published", category: "policies" })
          .eq("id", row.id);
        kb = "updated";
      } else {
        await supabase.from("knowledge_articles").insert({
          tenant_id,
          title: article.title,
          content: article.content,
          category: "policies",
          status: "published",
        });
        kb = "inserted";
      }
    } catch (kbErr) {
      console.error("[settings/booking] KB regen failed:", kbErr);
    }

    // The three contacts are read LIVE from the DB by the cloned workflows, so
    // writing the settings above is all that's needed — no n8n re-sync.
    return NextResponse.json({ success: true, kb });
  } catch (err: unknown) {
    console.error("[settings/booking] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
