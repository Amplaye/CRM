// Shared logo upload/compress helpers for the public "branding" Storage bucket.
//
// Two call sites brand a tenant with a logo and both want the same tiny-WebP
// pipeline: Settings → General uploads the CRM-CHROME logo (sidebar), and the menu
// dashboard uploads the PUBLIC-MENU logo (/m/<slug> header). They differ only in
// the file name under the tenant's folder, so the compress + upload + public-URL
// dance lives here once. Supabase Free shares ONE bucket across every tenant's
// logos and dish photos, so we deliberately keep logos small (~256px).
//
// Browser-only: compressImageToWebp draws to a <canvas>, so call these from a
// client component (both call sites already are).

import type { createClient } from "@/lib/supabase/client";

/** The browser Supabase client (from @/lib/supabase/client). Typed off the
 * factory so we don't have to guess the generic params. */
type BrowserSupabase = ReturnType<typeof createClient>;

/** The public bucket holding every tenant's logos and menu photos. */
const BRANDING_BUCKET = "branding";

/** Longest-side pixel cap for a compressed logo. */
const MAX_DIM = 256;

/**
 * Compress a picked image to a ~256px (longest side) WebP blob, entirely
 * client-side via a <canvas>. Preserves aspect ratio; never upscales. Rejects if
 * the file can't be decoded or the canvas isn't available.
 */
export function compressImageToWebp(file: File, max = MAX_DIM): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > max) {
        height = Math.round((height * max) / width);
        width = max;
      } else if (height >= width && height > max) {
        width = Math.round((width * max) / height);
        height = max;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
        "image/webp",
        0.9,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

/**
 * Compress `file` and upload it to the public branding bucket at
 * `${tenantId}/${fileName}`, returning a cache-busted public URL (the `?v=<size>`
 * suffix makes an overwritten logo refresh immediately instead of serving a stale
 * CDN copy). `fileName` is what keeps the CRM-chrome logo ("logo.webp") and the
 * public-menu logo ("menu-logo.webp") from clobbering each other. Under 4.5 MB
 * after compression, so a direct client upload is fine — no signed URL needed.
 */
export async function uploadBrandingLogo(
  supabase: BrowserSupabase,
  tenantId: string,
  file: File,
  fileName: string,
): Promise<string> {
  const blob = await compressImageToWebp(file);
  const path = `${tenantId}/${fileName}`;
  const { error } = await supabase.storage
    .from(BRANDING_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: true });
  if (error) throw error;
  const { data: pub } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path);
  return `${pub.publicUrl}?v=${blob.size}`;
}

/**
 * Best-effort delete of a branding logo file (ignores a missing file — removing a
 * logo that was never uploaded is a no-op, not an error).
 */
export async function removeBrandingLogo(
  supabase: BrowserSupabase,
  tenantId: string,
  fileName: string,
): Promise<void> {
  await supabase.storage
    .from(BRANDING_BUCKET)
    .remove([`${tenantId}/${fileName}`])
    .catch(() => {});
}
