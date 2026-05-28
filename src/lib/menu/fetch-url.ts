// Fetch a remote URL and decide whether the content is something we can
// extract a menu from. Three categories:
//
//   1. Direct PDF or image  → return as binary (caller forwards to vision)
//   2. Static HTML with menu text  → return cleaned text (caller forwards
//      to text extraction)
//   3. Dynamic SPA (TheFork, Flipdish, ...) where the HTML body is mostly
//      empty until JS runs  → return ok:false with a clear reason, the
//      UI then tells the user to download as PDF and re-import.

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB safety cap
const FETCH_TIMEOUT_MS = 12_000;

export type FetchResult =
  | { ok: true; kind: 'binary'; mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; base64: string }
  | { ok: true; kind: 'text'; text: string }
  | { ok: false; reason: 'too_large' | 'unreachable' | 'unsupported_type' | 'spa_no_content' | 'empty' | 'invalid_url'; details?: string };

const BINARY_TYPES: Record<string, 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

export async function fetchUrlContent(rawUrl: string): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'invalid_url' };
  }

  // Block private networks (SSRF guard). Avoids leaking to localhost / RFC1918.
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return { ok: false, reason: 'invalid_url', details: 'private network not allowed' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'BaliFlowCRM-MenuImport/1.0',
        Accept: 'application/pdf,image/*,text/html,*/*',
      },
    });
  } catch (e: any) {
    clearTimeout(timer);
    return { ok: false, reason: 'unreachable', details: e?.message };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return { ok: false, reason: 'unreachable', details: `HTTP ${res.status}` };
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  const contentLength = Number(res.headers.get('content-length') || '0');
  if (contentLength > MAX_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  if (BINARY_TYPES[contentType]) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return { ok: false, reason: 'too_large' };
    const base64 = Buffer.from(new Uint8Array(buf)).toString('base64');
    return { ok: true, kind: 'binary', mediaType: BINARY_TYPES[contentType], base64 };
  }

  if (contentType.startsWith('text/html') || contentType === 'application/xhtml+xml') {
    const html = await res.text();
    if (html.length > MAX_BYTES) return { ok: false, reason: 'too_large' };
    const cleaned = extractVisibleText(html);
    if (cleaned.length < 200) {
      // SPA shell (TheFork, Flipdish, etc.) → body is too thin for any AI
      // extraction. We refuse early so the user gets a real error instead
      // of an empty extracted menu.
      return {
        ok: false,
        reason: 'spa_no_content',
        details: 'The page is mostly empty until JavaScript runs. Try the PDF version of the menu.',
      };
    }
    return { ok: true, kind: 'text', text: cleaned };
  }

  return { ok: false, reason: 'unsupported_type', details: contentType };
}

/**
 * Best-effort HTML → text. Strips script/style/nav/footer noise and
 * collapses whitespace. Conservative on purpose — we want enough signal
 * for the LLM to find a menu, not a full DOM parse.
 */
export function extractVisibleText(html: string): string {
  let s = html;
  // Drop scripts, styles, and obvious noise tags entirely (including
  // their content). Case-insensitive, with a non-greedy match so we
  // don't accidentally swallow the rest of the page.
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ');
  s = s.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  s = s.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Drop all remaining tags but keep their text content.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&euro;/g, '€')
    .replace(/&apos;/g, "'");
  // Collapse whitespace.
  s = s.replace(/[\t\r]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ');
  return s.trim();
}
