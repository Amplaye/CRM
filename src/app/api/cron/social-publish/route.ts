import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures, type TenantSettings } from "@/lib/types/tenant-settings";
import { hasActivePlan } from "@/lib/billing/entitlements";
import { logSystemEvent } from "@/lib/system-log";
import { getSocialSecrets } from "@/lib/social/meta-connect";
import { publishToInstagram, publishToFacebook, type SocialMediaType } from "@/lib/social/meta-graph";

// Social publishing cron. Runs hourly (see CRON_JOBS). Picks up posts the owner
// APPROVED and scheduled for now-or-earlier, publishes them to the tenant's own
// Instagram/Facebook via the Graph API, and moves them published / failed.
//
// Opt-in + plan gated like post-visit-followup. Idempotent: a claim-transition
// approved/scheduled → publishing (guarded by .in() on the current status) means
// a second cron tick can't re-pick a post already being published. Publishes are
// recorded in audit_events (action 'social_published').

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  const { data: rows } = await supabase
    .from("social_posts")
    .select("id, tenant_id, status, media_type, caption, media_urls, targets, scheduled_at, tenants(name, settings)")
    .in("status", ["approved", "scheduled"])
    .lte("scheduled_at", now)
    .limit(50);

  let published = 0, skipped = 0, failed = 0;
  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];

  type Row = {
    id: string;
    tenant_id: string;
    status: string;
    media_type: SocialMediaType;
    caption: string | null;
    media_urls: string[] | null;
    targets: string[] | null;
    scheduled_at: string | null;
    tenants: { name: string | null; settings: TenantSettings | null } | null;
  };

  for (const r of (rows || []) as unknown as Row[]) {
    const settings = r.tenants?.settings;
    if (!hasActivePlan(settings) || !getFeatures(settings).social_enabled) { skipped++; continue; }

    const mediaUrls = Array.isArray(r.media_urls) ? r.media_urls : [];
    if (!mediaUrls.length) { skipped++; continue; }

    // Claim the post: approved/scheduled → publishing, only if still un-claimed.
    const { data: claimed } = await supabase
      .from("social_posts")
      .update({ status: "publishing", updated_at: new Date().toISOString() })
      .eq("id", r.id)
      .in("status", ["approved", "scheduled"])
      .select("id")
      .maybeSingle();
    if (!claimed) { skipped++; continue; } // another tick already took it

    const secrets = await getSocialSecrets(r.tenant_id, supabase);
    const caption = r.caption || "";
    const targets = Array.isArray(r.targets) ? r.targets : [];

    let igMediaId: string | undefined;
    let fbPostId: string | undefined;
    let errorMessage: string | undefined;

    if (targets.includes("instagram")) {
      if (!secrets.pageToken || !secrets.igUserId) {
        errorMessage = "Instagram not connected";
      } else {
        const res = await publishToInstagram({
          igUserId: secrets.igUserId,
          token: secrets.pageToken,
          mediaType: r.media_type,
          mediaUrls,
          caption,
        });
        if (res.ok) igMediaId = res.igMediaId;
        else errorMessage = res.errorMessage || "IG publish failed";
      }
    }

    if (!errorMessage && targets.includes("facebook")) {
      if (!secrets.pageToken || !secrets.pageId) {
        errorMessage = "Facebook not connected";
      } else {
        const res = await publishToFacebook({
          pageId: secrets.pageId,
          token: secrets.pageToken,
          mediaType: r.media_type,
          mediaUrls,
          caption,
        });
        if (res.ok) fbPostId = res.fbPostId;
        else errorMessage = res.errorMessage || "FB publish failed";
      }
    }

    if (!errorMessage && (igMediaId || fbPostId)) {
      published++;
      results.push({ id: r.id, ok: true });
      await supabase
        .from("social_posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          ig_media_id: igMediaId ?? null,
          fb_post_id: fbPostId ?? null,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      await supabase.from("audit_events").insert({
        tenant_id: r.tenant_id,
        action: "social_published",
        entity_id: r.id,
        source: "system",
        idempotency_key: `social:${r.id}`,
        details: { media_type: r.media_type, targets, ig_media_id: igMediaId, fb_post_id: fbPostId },
      });
    } else {
      failed++;
      results.push({ id: r.id, ok: false, reason: errorMessage });
      await supabase
        .from("social_posts")
        .update({ status: "failed", error: errorMessage || "publish failed", updated_at: new Date().toISOString() })
        .eq("id", r.id);
    }
  }

  if (failed) {
    await logSystemEvent({
      tenant_id: null,
      category: "system",
      severity: "high",
      title: `Social publish: ${failed} failed`,
      description: `published ${published}, skipped ${skipped}, failed ${failed}`,
      metadata: { published, skipped, failed, results: results.filter((x) => !x.ok).slice(0, 20) },
    });
  }

  return NextResponse.json({ ok: true, published, skipped, failed });
}
