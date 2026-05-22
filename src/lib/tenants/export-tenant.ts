import type { SupabaseClient } from "@supabase/supabase-js";

/** Private bucket holding pre-deletion backups (one JSON per archive event). */
export const EXPORT_BUCKET = "tenant-exports";

export interface TenantExport {
  exported_at: string;
  tenant: { id: string; name: string; status: string; settings: any; created_at: string };
  reservations: any[];
  guests: any[];
  conversations: any[];
  knowledge_articles: any[];
}

/** Build the downloadable backup: the tenant row + its reservations, guests,
 * conversations and knowledge_articles. */
export async function buildTenantExport(supabase: SupabaseClient, tenantId: string): Promise<TenantExport> {
  const [tenantRes, reservations, guests, conversations, kb] = await Promise.all([
    supabase.from("tenants").select("id, name, status, settings, created_at").eq("id", tenantId).single(),
    supabase.from("reservations").select("*").eq("tenant_id", tenantId),
    supabase.from("guests").select("*").eq("tenant_id", tenantId),
    supabase.from("conversations").select("*").eq("tenant_id", tenantId),
    supabase.from("knowledge_articles").select("*").eq("tenant_id", tenantId),
  ]);
  if (tenantRes.error || !tenantRes.data) throw new Error(`export: tenant ${tenantId} not found`);
  return {
    exported_at: new Date().toISOString(),
    tenant: tenantRes.data as any,
    reservations: (reservations as any).data || [],
    guests: (guests as any).data || [],
    conversations: (conversations as any).data || [],
    knowledge_articles: (kb as any).data || [],
  };
}

/** Upload the export JSON to the private bucket; return its path + a 7-day
 * signed download URL. Creating the bucket is idempotent (ignore "exists"). */
export async function uploadTenantExport(
  supabase: SupabaseClient,
  tenantId: string,
  data: TenantExport
): Promise<{ path: string; signedUrl: string | null }> {
  await supabase.storage.createBucket(EXPORT_BUCKET, { public: false }).catch(() => {});
  const path = `${tenantId}/${data.exported_at.replace(/[:.]/g, "-")}.json`;
  const { error } = await supabase.storage
    .from(EXPORT_BUCKET)
    .upload(path, JSON.stringify(data, null, 2), { contentType: "application/json", upsert: true });
  if (error) throw new Error(`export upload: ${error.message}`);
  const { data: signed } = await supabase.storage.from(EXPORT_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  return { path, signedUrl: signed?.signedUrl || null };
}
