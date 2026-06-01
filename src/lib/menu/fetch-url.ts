// Fetch a remote URL and decide whether the content is something we can
// extract a menu from. Three categories:
//
//   1. Direct PDF or image  → return as binary (caller forwards to vision)
//   2. Static HTML with menu text  → return cleaned text (caller forwards
//      to text extraction)
//   3. Dynamic SPA (TheFork, Flipdish, ...) where the HTML body is mostly
//      empty until JS runs  → return ok:false with a clear reason, the
//      UI then tells the user to download as PDF and re-import.

import dns from 'node:dns/promises';
import net from 'node:net';
import { MAX_UPLOAD_BYTES } from './limits';

const MAX_BYTES = MAX_UPLOAD_BYTES; // shared 25 MB cap (see limits.ts)
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

// SSRF guard: reject an IP literal that points at our own infrastructure or a
// private network. Covers IPv4 loopback/RFC1918/link-local/CGNAT and the cloud
// metadata address, plus IPv6 loopback/unspecified/ULA/link-local and
// IPv4-mapped IPv6. We resolve hostnames to IPs and check the *resolved*
// addresses, so DNS rebinding and a hostname that resolves to 169.254.169.254
// are both blocked — not just literal private hostnames.
function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 127) return true; // unspecified / loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('ff')) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded IPv4.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP literal → treat as blocked
}

// Resolve a hostname (or accept an IP literal) and reject if ANY resolved
// address is blocked. Returns the safe set of addresses to pin the connection.
async function assertHostAllowed(host: string): Promise<{ ok: true; addrs: string[] } | { ok: false }> {
  if (net.isIP(host)) {
    return isBlockedIp(host) ? { ok: false } : { ok: true, addrs: [host] };
  }
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) {
    return { ok: false };
  }
  let addrs: string[];
  try {
    const records = await dns.lookup(host, { all: true });
    addrs = records.map((r) => r.address);
  } catch {
    return { ok: false };
  }
  if (addrs.length === 0 || addrs.some(isBlockedIp)) return { ok: false };
  return { ok: true, addrs };
}

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

  // SSRF guard: validate the host of EVERY hop (initial + each redirect) by
  // resolving it to IPs and rejecting private/loopback/link-local/CGNAT/
  // metadata addresses. redirect:'manual' so a public URL cannot 30x us into
  // an internal address without re-validation.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    let current = url;
    let hops = 0;
    for (;;) {
      const allowed = await assertHostAllowed(current.hostname);
      if (!allowed.ok) {
        clearTimeout(timer);
        return { ok: false, reason: 'invalid_url', details: 'private network not allowed' };
      }
      const hop = await fetch(current.toString(), {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'BaliFlowCRM-MenuImport/1.0',
          Accept: 'application/pdf,image/*,text/html,*/*',
        },
      });
      // 3xx with a Location → validate the next hop ourselves.
      if (hop.status >= 300 && hop.status < 400 && hop.headers.get('location')) {
        if (++hops > MAX_REDIRECTS) {
          clearTimeout(timer);
          return { ok: false, reason: 'unreachable', details: 'too many redirects' };
        }
        let next: URL;
        try {
          next = new URL(hop.headers.get('location')!, current);
        } catch {
          clearTimeout(timer);
          return { ok: false, reason: 'invalid_url', details: 'bad redirect target' };
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          clearTimeout(timer);
          return { ok: false, reason: 'invalid_url', details: 'non-http redirect' };
        }
        current = next;
        continue;
      }
      res = hop;
      break;
    }
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
