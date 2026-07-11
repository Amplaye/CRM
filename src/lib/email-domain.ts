// Async email-domain reachability check for the PUBLIC booking widget.
//
// booking-validation.ts stays pure (no network/clock/DB); this lives apart
// because it does a DNS lookup. Goal: reject a syntactically-valid address
// whose domain cannot receive mail at all — "x@dominioinventato.xyz",
// "x@hotmail.con" (typo) — while accepting real inboxes ("x@hotmail.it").
//
// We can only prove the DOMAIN accepts mail, never that the exact mailbox
// exists — that would require actually sending, which the product forbids.
// So this is "plausible inbox", the strongest check possible without email.

import dns from 'node:dns/promises';

// Cheap in-process cache so a burst of bookings to the same domain (gmail.com,
// hotmail.it…) doesn't re-resolve every time. TTL keeps it from pinning a
// stale negative after a domain's DNS is fixed. Bounded by domain cardinality.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { ok: boolean; at: number }>();

/**
 * True when `domain` publishes MX records (or, as a fallback, resolves to an
 * A/AAAA record — RFC 5321 §5 allows mail to the A record when no MX exists).
 * Never throws; a lookup failure/timeout resolves to `false`.
 */
export async function domainCanReceiveMail(domain: string): Promise<boolean> {
  const d = domain.trim().toLowerCase();
  if (!d || d.includes(' ')) return false;

  const now = Date.now();
  const hit = cache.get(d);
  if (hit && now - hit.at < TTL_MS) return hit.ok;

  let ok = false;
  try {
    const mx = await dns.resolveMx(d);
    ok = Array.isArray(mx) && mx.some((r) => r.exchange && r.exchange.length > 0);
  } catch {
    ok = false;
  }
  if (!ok) {
    // No MX — fall back to A/AAAA (implicit MX per the RFC).
    try {
      const a = await dns.resolve(d).catch(() => [] as string[]);
      const aaaa = a.length ? [] : await dns.resolve6(d).catch(() => [] as string[]);
      ok = a.length > 0 || aaaa.length > 0;
    } catch {
      ok = false;
    }
  }

  cache.set(d, { ok, at: now });
  return ok;
}

/**
 * Full public-widget email check: pragmatic syntax (isEmail, done by the
 * caller) THEN domain reachability. Returns the domain's verdict; the caller
 * has already guaranteed a single "@" so splitting on it is safe here.
 */
export async function emailDomainReachable(email: string): Promise<boolean> {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1);
  return domainCanReceiveMail(domain);
}
