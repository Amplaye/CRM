import type { MetadataRoute } from "next";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFeatures } from "@/lib/types/tenant-settings";

// Sitemap for the guest-facing pages. Only tenants that actually serve traffic
// (trial/active) are listed: the hosted menu for everyone, the micro-site for
// tenants with website_enabled. Dashboard/API routes deliberately never appear.
export const dynamic = "force-dynamic";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://app.baliflowagency.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sb = createServiceRoleClient();
  const { data } = await sb
    .from("tenants")
    .select("slug,status,settings")
    .in("status", ["trial", "active"]);

  const entries: MetadataRoute.Sitemap = [];
  for (const t of data || []) {
    entries.push({ url: `${BASE}/m/${t.slug}`, changeFrequency: "weekly", priority: 0.6 });
    if (getFeatures(t.settings).website_enabled) {
      entries.push({ url: `${BASE}/s/${t.slug}`, changeFrequency: "weekly", priority: 0.8 });
    }
  }
  return entries;
}
