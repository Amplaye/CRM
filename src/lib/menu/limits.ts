// Single source of truth for menu-import limits and accepted file types.
// Referenced by the client (menu/page.tsx), the import-job route, and the URL
// fetcher (fetch-url.ts) so the cap can never drift between layers.

// Upload size cap. Raised from 8 MB → 25 MB so big multi-page menus (and the
// occasional high-res scan) go through. The real bottleneck for large menus is
// PAGE COUNT during OpenAI vision, not megabytes — that's handled by chunked
// reading in the worker (see PAGES_PER_CHUNK), not by this number.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / 1024 / 1024;

// Image/PDF types we send to the vision path (kept identical to the worker's
// expectations). Keys are MIME types; values are the canonical media type.
export type VisionMediaType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif';

export const VISION_MIME: Record<string, VisionMediaType> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

// Same mapping keyed by file extension — the fallback when a file arrives with a
// blank/generic MIME type. Used by the storage-upload path (a file read back
// from Storage may not carry its original content-type) and by drag-drop where
// the browser sometimes reports an empty `type`.
const EXT_VISION_MIME: Record<string, VisionMediaType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Resolve a vision media type from a MIME type first, then the filename
// extension. Returns undefined for anything we don't send to the vision path.
export function resolveVisionMediaType(
  fileType: string | undefined | null,
  fileName: string | undefined | null
): VisionMediaType | undefined {
  const byMime = fileType ? VISION_MIME[fileType.toLowerCase()] : undefined;
  if (byMime) return byMime;
  const ext = (fileName?.split('.').pop() || '').toLowerCase();
  return EXT_VISION_MIME[ext];
}

// File extensions we accept in the picker / drag-drop, for the cases where the
// browser reports a blank or generic MIME type. Includes the doc types handled
// by doc-text.ts (.docx, .csv) alongside PDF/images.
export const ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.docx',
  '.csv',
] as const;

// How many PDF pages we send to OpenAI vision per chunk. A dense menu page can
// carry 20-40 dishes; at ~90 output tokens/dish, 4 pages (~120 dishes ≈ 11k
// tokens) stays comfortably under gpt-4o's 16k output cap with headroom, and
// each chunk finishes well within the worker's 150s window. Conservative on
// purpose — the worker re-splits a chunk that still truncates.
export const PAGES_PER_CHUNK = 4;
