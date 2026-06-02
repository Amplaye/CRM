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

  // Paint at native size first, then downscale into a second canvas if needed.
  const src = document.createElement('canvas');
  src.width = width;
  src.height = height;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  sctx.putImageData(new ImageData(rgba, width, height), 0, 0);

  let outCanvas = src;
  const longEdge = Math.max(width, height);
  if (longEdge > TARGET_MAX_EDGE) {
    const scale = TARGET_MAX_EDGE / longEdge;
    const dw = Math.max(1, Math.round(width * scale));
    const dh = Math.max(1, Math.round(height * scale));
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
  let getDocumentProxy: typeof import('unpdf').getDocumentProxy;
  let extractImages: typeof import('unpdf').extractImages;
  try {
    ({ getDocumentProxy, extractImages } = await import('unpdf'));
  } catch {
    return [];
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    const out: ExtractedPhoto[] = [];

    for (let page = 1; page <= pdf.numPages && out.length < MAX_PHOTOS; page++) {
      let images: Array<{
        data: Uint8ClampedArray;
        width: number;
        height: number;
        channels: 1 | 3 | 4;
      }>;
      try {
        images = (await extractImages(pdf, page)) as typeof images;
      } catch {
        continue; // a single bad page shouldn't kill the rest
      }
      for (let indexOnPage = 0; indexOnPage < images.length && out.length < MAX_PHOTOS; indexOnPage++) {
        const im = images[indexOnPage];
        const geom: RawExtractedImage = { width: im.width, height: im.height, channels: im.channels };
        if (!isPhotoCandidate(geom)) continue;
        let blob: Blob | null;
        try {
          blob = await encodeRawToWebp(im);
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
        out.push({ page, indexOnPage, blob, dataUrl });
      }
    }
    return out;
  } catch {
    return [];
  }
}
