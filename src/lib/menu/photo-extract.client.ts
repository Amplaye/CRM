// Browser-only half of the dish-photo import feature.
// ---------------------------------------------------------------------------
// Runs in the import modal after the menu text is extracted. Pulls the embedded
// images out of the uploaded PDF (unpdf → raw RGBA pixels), keeps the ones that
// look like dish photos (pure filter in photo-extract.ts), and re-encodes each
// as a small WebP via canvas — exactly the pipeline the manual photo upload
// already uses (≤1400px, q0.82), so the bucket stays light.
//
// Kept out of photo-extract.ts (which is pure + unit-tested in Node) because
// this touches `document`/canvas and dynamically imports unpdf. Import this
// only from client components.

import { isPhotoCandidate, type RawExtractedImage } from './photo-extract';

// One extracted dish-photo candidate ready for the AI pairing + preview.
export type ExtractedPhoto = {
  /** 1-based page it came from (debug/telemetry only). */
  page: number;
  /** Index within that page, unpdf order (debug only). */
  indexOnPage: number;
  /** Compressed WebP, ready to upload to the bucket. */
  blob: Blob;
  /** data: URL (image/webp) to send to the AI matcher AND show in preview. */
  dataUrl: string;
};

// Hard cap so a pathological PDF (hundreds of tiny embedded glyphs that slip
// the filter) can't lock the browser or blow the match-photos payload. Mirrors
// the server MAX_IMAGES in /api/menu/match-photos.
const MAX_PHOTOS = 60;
const TARGET_MAX_EDGE = 1400; // same as manual upload compressToWebp
const WEBP_QUALITY = 0.82;

/**
 * Encode a raw RGBA/RGB/grayscale pixel buffer (as unpdf yields) into a
 * downscaled WebP blob via canvas. Returns null if the browser can't encode.
 */
// Downscale a source canvas to ≤TARGET_MAX_EDGE on the long edge and encode it
// as WebP. Shared tail of both the bitmap and raw-pixel paths.
async function canvasToWebp(src: HTMLCanvasElement): Promise<Blob | null> {
  let outCanvas = src;
  const longEdge = Math.max(src.width, src.height);
  if (longEdge > TARGET_MAX_EDGE) {
    const scale = TARGET_MAX_EDGE / longEdge;
    const dw = Math.max(1, Math.round(src.width * scale));
    const dh = Math.max(1, Math.round(src.height * scale));
    const dst = document.createElement('canvas');
    dst.width = dw;
    dst.height = dh;
    const dctx = dst.getContext('2d');
    if (!dctx) return null;
    dctx.drawImage(src, 0, 0, dw, dh);
    outCanvas = dst;
  }
  return await new Promise<Blob | null>((resolve) => {
    outCanvas.toBlob((b) => resolve(b), 'image/webp', WEBP_QUALITY);
  });
}

// Browser path: pdf.js hands us an ImageBitmap (img.bitmap) — draw it straight
// onto a canvas. This is the common case in Chrome/Safari/Firefox.
async function encodeBitmapToWebp(
  bitmap: ImageBitmap,
  width: number,
  height: number
): Promise<Blob | null> {
  const src = document.createElement('canvas');
  src.width = width;
  src.height = height;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  sctx.drawImage(bitmap, 0, 0, width, height);
  return canvasToWebp(src);
}

// Fallback path: pdf.js gave us raw pixel bytes (img.data) instead of a bitmap
// (this is what Node returns; some builds may too). Pack to RGBA, then encode.
async function encodeRawToWebp(img: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
}): Promise<Blob | null> {
  // Normalize to RGBA for putImageData (it only accepts 4 channels).
  const { width, height, channels } = img;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (channels === 4) {
    rgba.set(img.data.subarray(0, rgba.length));
  } else if (channels === 3) {
    for (let p = 0, q = 0; p < img.data.length; p += 3, q += 4) {
      rgba[q] = img.data[p];
      rgba[q + 1] = img.data[p + 1];
      rgba[q + 2] = img.data[p + 2];
      rgba[q + 3] = 255;
    }
  } else {
    // grayscale
    for (let p = 0, q = 0; p < img.data.length; p += 1, q += 4) {
      const v = img.data[p];
      rgba[q] = v;
      rgba[q + 1] = v;
      rgba[q + 2] = v;
      rgba[q + 3] = 255;
    }
  }

  const src = document.createElement('canvas');
  src.width = width;
  src.height = height;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  sctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvasToWebp(src);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
    fr.readAsDataURL(blob);
  });
}

/**
 * Extract dish-photo candidates from a PDF File and return them as compressed
 * WebP blobs + data URLs, in stable order. Best-effort: any failure (not a PDF,
 * unpdf throws, no candidates) resolves to [] so the import never breaks.
 */
export async function extractPdfPhotos(file: File): Promise<ExtractedPhoto[]> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return [];
  }
  // NOTE: we deliberately do NOT use unpdf's extractImages() here. In the
  // BROWSER it returns 0 images: pdf.js loads page image XObjects lazily and
  // page.objs.get(key, cb) never resolves until the page is actually rendered
  // — extractImages skips them silently (verified: 48 images in Node, 0 in
  // Chromium). So we replicate it ourselves but RENDER each page to an
  // off-screen canvas first, which populates page.objs, then read the image
  // XObjects out of the operator list. (Node works without the render; the
  // render is cheap and harmless, so we always do it.)
  let getDocumentProxy: typeof import('unpdf').getDocumentProxy;
  let getResolvedPDFJS: typeof import('unpdf').getResolvedPDFJS;
  try {
    ({ getDocumentProxy, getResolvedPDFJS } = await import('unpdf'));
  } catch {
    return [];
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    const { OPS } = await getResolvedPDFJS();
    const out: ExtractedPhoto[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages && out.length < MAX_PHOTOS; pageNum++) {
      let page: Awaited<ReturnType<typeof pdf.getPage>>;
      try {
        page = await pdf.getPage(pageNum);
      } catch {
        continue;
      }

      // Render the page to an off-screen canvas so pdf.js resolves the image
      // objects. We never read these pixels; this is purely to populate objs.
      try {
        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // pdf.js render signature varies slightly across builds; pass both
          // canvas and canvasContext to satisfy the serverless build unpdf uses.
          await (page as unknown as {
            render: (o: Record<string, unknown>) => { promise: Promise<void> };
          })
            .render({ canvas, canvasContext: ctx, viewport })
            .promise;
        }
      } catch {
        // If render fails we still try to read objs below — on some PDFs the
        // objects are already resolved.
      }

      let opList: { fnArray: number[]; argsArray: unknown[][] };
      try {
        opList = (await page.getOperatorList()) as typeof opList;
      } catch {
        continue;
      }

      let indexOnPage = -1;
      for (let i = 0; i < opList.fnArray.length && out.length < MAX_PHOTOS; i++) {
        if (opList.fnArray[i] !== OPS.paintImageXObject) continue;
        const key = opList.argsArray[i][0] as string;
        if (typeof key !== 'string') continue;
        indexOnPage++; // 0-based index among image XObjects on this page

        const store = key.startsWith('g_')
          ? (page as unknown as { commonObjs: { get: (k: string, cb: (v: unknown) => void) => void } }).commonObjs
          : (page as unknown as { objs: { get: (k: string, cb: (v: unknown) => void) => void } }).objs;
        const image = (await new Promise<unknown>((resolve) => {
          try {
            store.get(key, resolve);
          } catch {
            resolve(null);
          }
        })) as {
          data?: Uint8ClampedArray | null;
          bitmap?: ImageBitmap | null;
          width?: number;
          height?: number;
        } | null;

        if (!image || !image.width || !image.height) continue;
        const width = image.width;
        const height = image.height;

        // pdf.js gives an ImageBitmap in the browser and raw bytes in Node.
        // For the candidate filter (geometry only) we don't need channels when
        // we have a bitmap. For the raw path we derive channels from byte length.
        let channels: 1 | 3 | 4 = 3;
        const hasBitmap = !!image.bitmap;
        if (!hasBitmap) {
          if (!image.data || !image.data.length) continue;
          const calc = image.data.length / (width * height);
          if (calc !== 1 && calc !== 3 && calc !== 4) continue;
          channels = calc as 1 | 3 | 4;
        }

        const geom: RawExtractedImage = { width, height, channels };
        if (!isPhotoCandidate(geom)) continue;

        let blob: Blob | null;
        try {
          blob = hasBitmap
            ? await encodeBitmapToWebp(image.bitmap as ImageBitmap, width, height)
            : await encodeRawToWebp({ data: image.data as Uint8ClampedArray, width, height, channels });
        } catch {
          blob = null;
        }
        if (!blob) continue;
        let dataUrl: string;
        try {
          dataUrl = await blobToDataUrl(blob);
        } catch {
          continue;
        }
        out.push({ page: pageNum, indexOnPage, blob, dataUrl });
      }
    }
    return out;
  } catch {
    return [];
  }
}
