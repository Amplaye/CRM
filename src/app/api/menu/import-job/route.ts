import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { tryExtractPdfText } from '@/lib/menu/pdf-text';
import { tryExtractDocText, resolveDocKind } from '@/lib/menu/doc-text';
import { maybeSplitPdf } from '@/lib/menu/pdf-split';
import { fetchUrlContent } from '@/lib/menu/fetch-url';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, resolveVisionMediaType, type VisionMediaType } from '@/lib/menu/limits';

// Create an async menu-extraction job. Replaces the slow, synchronous
// /api/menu/import-file: instead of blocking on the OpenAI call (which on a
// large PDF exceeds Vercel Hobby's 60s cap and the browser fetch dies with
// "Failed to fetch"), we insert a 'pending' row and hand the heavy work to the
// Supabase Edge Function `menu-extract` (150s window), then return a jobId
// immediately. The client polls GET /api/menu/import-job/[id].
//
// Accepts EITHER:
//   - multipart/form-data with `tenant_id` + `file` (a PDF/image upload), or
//   - application/json with `{ tenant_id, url }` (the restaurant's existing QR
//     target). The URL path runs through the SAME async worker so an image-only
//     PDF behind a URL (e.g. the Fuji carta, ~90s in vision) no longer dies on
//     Vercel's 60s cap with an HTML error page — the bug that surfaced client
//     side as `Unexpected token 'A', "An error o"... is not valid JSON`.
//
// Auth: signed-in dashboard user only. RLS-checked tenant membership before we
// store anything.

export const runtime = 'nodejs';
// Only needs to read the upload (up to ~25MB) or fetch the URL, then insert a
// row and fire-and-forget the worker. Returns in ~1-2s (a URL fetch adds the
// download time, still well under the cap); 60 is just headroom.
export const maxDuration = 60;

// The shape we insert into menu_import_jobs (status/created_by added by the
// caller). The Edge Function branches on `source`:
//   - 'text'  → source_text
//   - 'file'  → a single file_base64 + media_type (image / small PDF), OR
//               file_chunks[] for a large multi-page image PDF that was split
//               into page-chunks so each fits one vision call.
type JobPayload =
  | { source: 'text'; source_text: string; file_base64: null; media_type: null; file_chunks: null }
  | { source: 'file'; source_text: null; file_base64: string; media_type: string; file_chunks: null }
  | { source: 'file'; source_text: null; file_base64: null; media_type: 'application/pdf'; file_chunks: string[] };

// The JSON request body: a `url` (QR target) OR a `storage_path` (a large file
// the browser uploaded straight to Storage to dodge Vercel's 4.5 MB body cap).
type JsonJobBody = {
  tenant_id?: string;
  url?: string;
  storage_path?: string;
  file_name?: string;
  file_type?: string;
};

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contentType = (req.headers.get('content-type') || '').toLowerCase();

  // Resolve the request into (tenantId, JobPayload) regardless of whether it's
  // a file upload (multipart) or a URL (JSON). On a client error we return a
  // NextResponse directly.
  let tenantId: string;
  let payload: JobPayload;

  if (contentType.includes('application/json')) {
    // JSON carries EITHER a `url` (the restaurant's QR target) OR a
    // `storage_path` (a large file the browser uploaded straight to Storage to
    // dodge Vercel's 4.5 MB body cap — see /api/menu/upload-url).
    const body = (await req.json().catch(() => null)) as JsonJobBody | null;
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const resolved =
      typeof body.storage_path === 'string' && body.storage_path
        ? await resolveStorageJob(body)
        : await resolveUrlJob(body);
    if (resolved instanceof NextResponse) return resolved;
    tenantId = resolved.tenantId;
    payload = resolved.payload;
  } else {
    const resolved = await resolveFileJob(req);
    if (resolved instanceof NextResponse) return resolved;
    tenantId = resolved.tenantId;
    payload = resolved.payload;
  }

  // RLS sanity-check: confirm the user can access the tenant before we store a
  // multi-MB blob. The select hits tenants with RLS enabled — it returns a row
  // only if the user is a member (or platform_admin).
  const { data: tenantRow, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantErr || !tenantRow) {
    return NextResponse.json({ error: 'Tenant not accessible' }, { status: 403 });
  }

  // Insert the pending job via the service role (table writes are service-role
  // only by design — see the migration).
  const admin = createServiceRoleClient();
  const { data: job, error: insErr } = await admin
    .from('menu_import_jobs')
    .insert({ tenant_id: tenantId, status: 'pending', created_by: user.id, ...payload })
    .select('id')
    .single();

  if (insErr || !job) {
    console.error('[menu import-job] insert failed', insErr);
    return NextResponse.json({ error: 'Could not create import job' }, { status: 500 });
  }

  // Fire-and-forget the worker. We do NOT await its body: the Edge Function
  // writes its own status to the row, so its lifetime is independent of this
  // request (which may be killed at 60s). keepalive lets the dispatch survive
  // the function returning. If the kick fails to even dispatch, the job stays
  // 'pending' and the client poll will eventually time out with a clear error.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const workerSecret = process.env.WORKER_SHARED_SECRET || '';
  try {
    void fetch(`${supaUrl}/functions/v1/menu-extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        ...(workerSecret ? { 'x-worker-secret': workerSecret } : {}),
      },
      body: JSON.stringify({ jobId: job.id }),
      keepalive: true,
    }).catch((e) => console.error('[menu import-job] worker kick failed', e));
  } catch (e) {
    console.error('[menu import-job] worker kick threw', e);
  }

  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}

// Multipart file upload → JobPayload. Reads the upload, validates type/size,
// then routes by kind:
//   - .docx / .csv  → extract text here → 'text' job
//   - PDF with a real text layer → extract text here → 'text' job (fast path)
//   - image-only PDF / images → 'file' job (worker runs vision)
async function resolveFileJob(
  req: NextRequest
): Promise<{ tenantId: string; payload: JobPayload } | NextResponse> {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });

  const tenantId = form.get('tenant_id');
  const file = form.get('file');
  if (typeof tenantId !== 'string' || !tenantId) {
    return NextResponse.json({ error: 'Missing tenant_id' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_UPLOAD_MB} MB)` }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return buildFileJobFromBytes(bytes, file.name, file.type, tenantId);
}

// Storage upload (large file) → JobPayload. The browser PUT the raw file into
// the private `menu-imports` bucket via a signed URL (see /api/menu/upload-url),
// dodging Vercel's 4.5 MB body cap; here we read it back with the service role
// and feed it into the SAME pipeline as a multipart upload. Best-effort delete
// of the temp object afterwards: the worker reads file_base64 from the DB row,
// so once we've snapshotted the bytes the Storage copy is dead weight.
async function resolveStorageJob(
  body: JsonJobBody
): Promise<{ tenantId: string; payload: JobPayload } | NextResponse> {
  const tenantId = body.tenant_id;
  const storagePath = body.storage_path;
  if (typeof tenantId !== 'string' || !tenantId || typeof storagePath !== 'string' || !storagePath) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  // The signed URL was minted under `${tenantId}/…`; refuse anything else so a
  // caller can't point us at another tenant's object or escape the bucket.
  if (!storagePath.startsWith(`${tenantId}/`) || storagePath.includes('..')) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: blob, error: dlErr } = await admin.storage.from('menu-imports').download(storagePath);
  if (dlErr || !blob) {
    console.error('[menu import-job] storage download failed', dlErr);
    return NextResponse.json({ error: 'Could not read the uploaded file' }, { status: 422 });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  void admin.storage
    .from('menu-imports')
    .remove([storagePath])
    .catch((e: unknown) => console.error('[menu import-job] temp cleanup failed', e));

  return buildFileJobFromBytes(bytes, body.file_name || storagePath, body.file_type || '', tenantId);
}

// Shared tail for both file paths (multipart upload + Storage read-back): route
// the raw bytes by kind. `fileType` may be blank when the bytes came back from
// Storage, so media-type resolution falls back to the filename extension.
async function buildFileJobFromBytes(
  bytes: Uint8Array,
  fileName: string,
  fileType: string,
  tenantId: string
): Promise<{ tenantId: string; payload: JobPayload } | NextResponse> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_UPLOAD_MB} MB)` }, { status: 413 });
  }

  // Office/data docs (.docx, .csv): convert to text and take the fast text
  // path. Checked first since their MIME types are distinct from PDF/images.
  const docKind = resolveDocKind(fileType, fileName);
  if (docKind) {
    const docText = await tryExtractDocText(bytes, docKind);
    if (!docText) {
      return NextResponse.json(
        { error: 'Could not read any menu text from this document. Try a PDF or an image instead.' },
        { status: 422 }
      );
    }
    return {
      tenantId,
      payload: { source: 'text', source_text: docText, file_base64: null, media_type: null, file_chunks: null },
    };
  }

  const mediaType = resolveVisionMediaType(fileType, fileName);
  if (!mediaType) {
    return NextResponse.json(
      { error: `Unsupported file type "${fileType || fileName}". Use PDF, an image (JPEG/PNG/WEBP/GIF), Word (.docx) or CSV.` },
      { status: 415 }
    );
  }

  // Snapshot the upload as base64 NOW, before anything can touch `bytes`.
  // tryExtractPdfText() runs the bytes through pdf.js (via unpdf), which
  // TRANSFERS/neuters the underlying ArrayBuffer — after it returns, `bytes`
  // is detached (length 0). If we computed base64 *after* that call, an
  // image-only PDF (no text layer → vision fallback) would be stored with an
  // empty file_base64, and the worker would fail with "Job has no
  // file_base64/source_text to extract". Computing it up front is immune to
  // the detach regardless of pdf.js internals.
  const fileBase64 = Buffer.from(bytes).toString('base64');

  // HYBRID FAST PATH: if this is a PDF with a real embedded text layer (most
  // menus exported from Word/Canva/InDesign), extract the text here and send it
  // to OpenAI as TEXT — far faster + cheaper than vision, and crucially it
  // finishes well within the 60s platform cap that was killing large image
  // PDFs. Scanned/image-only PDFs yield no text → fall back to the file/vision
  // path unchanged. Images (jpg/png/...) always go the file path.
  const pdfText = mediaType === 'application/pdf' ? await tryExtractPdfText(bytes) : null;
  if (pdfText) {
    return {
      tenantId,
      payload: { source: 'text', source_text: pdfText.text, file_base64: null, media_type: null, file_chunks: null },
    };
  }

  return {
    tenantId,
    payload: await buildVisionPayload(fileBase64, mediaType),
  };
}

// Build the vision-path payload from a base64 blob. For a multi-page image-only
// PDF, split it into page-chunks so the worker reads a huge menu in several
// bounded vision calls instead of one that would time out / truncate. Images
// and small PDFs go through whole as a single file_base64.
async function buildVisionPayload(
  fileBase64: string,
  mediaType: VisionMediaType
): Promise<JobPayload> {
  if (mediaType === 'application/pdf') {
    const split = await maybeSplitPdf(Buffer.from(fileBase64, 'base64'));
    if (split.chunked) {
      return { source: 'file', source_text: null, file_base64: null, media_type: 'application/pdf', file_chunks: split.chunks };
    }
  }
  return { source: 'file', source_text: null, file_base64: fileBase64, media_type: mediaType, file_chunks: null };
}

// JSON `{ tenant_id, url }` → JobPayload. Fetches the URL (SSRF-guarded), then
// maps the result onto the same job shape: a binary PDF/image becomes a 'file'
// job (worker uses vision), cleaned HTML text becomes a 'text' job. The slow
// OpenAI call happens later in the worker, so a vision-only menu (e.g. the Fuji
// PDF, ~90s) no longer times out this request.
async function resolveUrlJob(
  body: JsonJobBody
): Promise<{ tenantId: string; payload: JobPayload } | NextResponse> {
  if (typeof body.tenant_id !== 'string' || !body.tenant_id || typeof body.url !== 'string') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const fetched = await fetchUrlContent(body.url);
  if (!fetched.ok) {
    const msgMap: Record<string, string> = {
      invalid_url: 'Invalid URL.',
      unreachable: 'Could not reach the URL.',
      too_large: `File at this URL is too large (max ${MAX_UPLOAD_MB} MB).`,
      unsupported_type: 'Unsupported content type at this URL.',
      spa_no_content:
        'Questa pagina carica il menu via JavaScript e non riusciamo a leggerla. Apri il menu sul telefono, fai uno screenshot e caricalo qui come immagine (tab "File").',
      empty: 'No menu content found at this URL.',
    };
    return NextResponse.json(
      { error: msgMap[fetched.reason] || fetched.reason, reason: fetched.reason, details: fetched.details },
      { status: 422 }
    );
  }

  if (fetched.kind === 'binary') {
    return {
      tenantId: body.tenant_id,
      payload: await buildVisionPayload(fetched.base64, fetched.mediaType),
    };
  }
  return {
    tenantId: body.tenant_id,
    payload: { source: 'text', source_text: fetched.text, file_base64: null, media_type: null, file_chunks: null },
  };
}
