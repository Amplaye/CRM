import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import { assertCredits, consumeCredits } from "@/lib/billing/credits";
import { getFeatures } from "@/lib/types/tenant-settings";
import { composeCaption, type SocialPostType } from "@/lib/social/compose";
import { apiError } from "@/lib/api-error";

// AI caption generator for the Social composer. Same credit-metered shape as
// marketing/generate: assert BEFORE the OpenAI call, consume AFTER a usable
// draft (a failed/unparseable generation lands in composeCaption's { ok:false }
// and we return without charging).

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = String(body.tenant_id || "");
    const postType = (["image", "carousel", "reels"].includes(body.post_type) ? body.post_type : "image") as SocialPostType;
    const dishes: string[] = Array.isArray(body.dishes) ? body.dishes.map((d: unknown) => String(d)) : [];
    if (!tenantId) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

    const member = await verifyTenantMembership(tenantId, ["owner", "manager", "marketing"]);
    if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const svc = createServiceRoleClient();
    const { data: tenant } = await svc.from("tenants").select("name, settings").eq("id", tenantId).maybeSingle();
    if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!getFeatures(tenant.settings).social_enabled) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 403 });
    }

    const credits = await assertCredits(tenantId, "social_caption");
    if (credits) return credits;

    const locale = (tenant.settings as { crm_locale?: string } | null)?.crm_locale || "es";
    const cuisine = (tenant.settings as { cuisine?: string } | null)?.cuisine;

    const result = await composeCaption({
      restaurantName: tenant.name,
      locale,
      postType,
      dishes,
      cuisine,
    });
    if (!result.ok) {
      // ai_not_configured → 503; any other generation failure → 502 (uncharged).
      const status = result.error === "ai_not_configured" ? 503 : 502;
      return NextResponse.json({ error: result.error || "compose_failed" }, { status });
    }

    await consumeCredits(tenantId, "social_caption", {
      costEur: 0.01,
      metadata: { model: "gpt-4o", feature: "social_compose", postType },
    });

    return NextResponse.json({ success: true, caption: result.caption, hashtags: result.hashtags });
  } catch (e) {
    return apiError(e, { route: "social/compose", publicMessage: "internal" });
  }
}
