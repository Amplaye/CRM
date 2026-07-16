import type { createClient } from "@/lib/supabase/client";
import { compressImageToWebp } from "@/lib/branding/upload-logo";

const BRANDING_BUCKET = "branding";

/** Compress to a web-friendly WebP (bigger cap than logos — these are photos)
 * and upload to the shared branding bucket under the tenant folder. Used by
 * the Website dashboard (hero/gallery) and the visual editor (template blocks). */
export async function uploadSitePhoto(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  file: File,
  fileName: string,
): Promise<string> {
  const blob = await compressImageToWebp(file, 1600);
  const path = `${tenantId}/${fileName}`;
  const { error } = await supabase.storage
    .from(BRANDING_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: true });
  if (error) throw error;
  const { data: pub } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path);
  return `${pub.publicUrl}?v=${blob.size}`;
}

/** Stable per-block file name for images edited in the visual editor —
 * re-uploading the same block overwrites instead of piling up files. */
export function siteBlockFileName(template: string, blockId: string): string {
  return `site-${template}-${blockId.replace(/[^a-z0-9_-]+/gi, "_")}.webp`;
}
