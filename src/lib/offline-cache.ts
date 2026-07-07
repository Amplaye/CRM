// Tenant-scoped, read-only offline cache for the PWA.
//
// Purpose: when the network drops (or the installed app is cold-launched with
// no connection) the dashboard can still SHOW the last-loaded reference data —
// menu, categories, tables — and today's reservations. It is deliberately a
// thin layer over localStorage (via safe-storage), NOT IndexedDB: the payloads
// are small (trimmed columns, today-only reservations), and the project already
// caches to localStorage/sessionStorage this way (see TenantContext). Keeping
// one storage model keeps things simple.
//
// SAFETY INVARIANTS (do not weaken):
//   • The tenant id is baked into every key, so tenant B can never read tenant
//     A's cache entry — isolation by construction, not by a runtime check.
//   • Only reference/read data is ever cached here. NEVER cache open orders,
//     the cassa session, receipts, totals, or anything money/fiscal — those are
//     server-authoritative and must always come from the network.
//   • Empty/failed reads must NOT be written (a failed fetch must not poison the
//     cache and mask real data on the next offline read).
//   • Everything is purged on logout and on tenant switch (see AuthContext /
//     TenantContext), so a stale copy never outlives the session that made it.

import { safeLocal } from "./safe-storage";

const PREFIX = "bf_offline_v1_";

// Reference datasets we cache. reservations are keyed additionally by date.
export type OfflineKind = "menu" | "categories" | "tables" | "reservations";

type Envelope<T> = { cachedAt: number; data: T };

function dataKey(tenantId: string, kind: OfflineKind, date?: string): string {
  const base = `${PREFIX}${kind}_${tenantId}`;
  return date ? `${base}_${date}` : base;
}

function indexKey(tenantId: string): string {
  return `${PREFIX}index_${tenantId}`;
}

// We maintain a per-tenant index of the keys we've written so purge is
// deterministic without iterating the whole localStorage keyspace.
function readIndex(tenantId: string): string[] {
  const raw = safeLocal.get(indexKey(tenantId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

function addToIndex(tenantId: string, key: string): void {
  const idx = readIndex(tenantId);
  if (idx.includes(key)) return;
  idx.push(key);
  safeLocal.set(indexKey(tenantId), JSON.stringify(idx));
}

/**
 * Persist a reference dataset for offline use. No-ops (and does NOT touch the
 * existing cache) when the payload is empty or falsy — a failed/empty fetch
 * must never overwrite good cached data.
 */
export function writeOfflineCache<T>(
  tenantId: string | null | undefined,
  kind: OfflineKind,
  data: T,
  date?: string,
): void {
  if (!tenantId) return;
  // Guard: never cache empty/absent results.
  if (data == null) return;
  if (Array.isArray(data) && data.length === 0) return;

  const key = dataKey(tenantId, kind, date);
  const envelope: Envelope<T> = { cachedAt: Date.now(), data };
  try {
    safeLocal.set(key, JSON.stringify(envelope));
    addToIndex(tenantId, key);
  } catch {
    // quota / private mode — safeLocal already swallows, this is belt-and-braces
  }
}

/**
 * Read a cached reference dataset. Returns null if absent or unparseable.
 * The caller decides whether to render it (typically only when offline / after
 * a failed live read) and should surface `cachedAt` as a "last updated" hint.
 */
export function readOfflineCache<T>(
  tenantId: string | null | undefined,
  kind: OfflineKind,
  date?: string,
): Envelope<T> | null {
  if (!tenantId) return null;
  const raw = safeLocal.get(dataKey(tenantId, kind, date));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (!parsed || typeof parsed.cachedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Remove offline cache entries. Pass a tenantId to purge just that tenant's
 * data; pass nothing to purge every tenant's offline cache on this device
 * (used on logout, where we don't want to assume which tenant was active).
 */
// Last-good tenant context snapshot, keyed by user id. Lets the PWA boot
// offline from a cold launch (sessionStorage is per-tab-session and empty on
// launch, and the Supabase membership query needs the network). Lives under
// PREFIX so the existing logout/switch purge sweeps it with everything else.
function tenantCtxKey(userId: string): string {
  return `${PREFIX}tenantctx_${userId}`;
}

export function writeOfflineTenantCtx(
  userId: string | null | undefined,
  ctx: unknown,
): void {
  if (!userId || ctx == null) return;
  safeLocal.set(tenantCtxKey(userId), JSON.stringify(ctx));
}

export function readOfflineTenantCtx<T>(
  userId: string | null | undefined,
): T | null {
  if (!userId) return null;
  const raw = safeLocal.get(tenantCtxKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Delete the service worker's offline page-HTML caches (the `bf-pages-*`
 * caches written by public/sw.js on successful navigations). Called alongside
 * purgeOfflineCache on logout and tenant switch so a cached dashboard page
 * can never be reopened offline by the next user on a shared device. The
 * name prefix is a contract with sw.js — rename both together. Fire-and-forget.
 */
export function purgeOfflinePages(): void {
  try {
    if (typeof caches === "undefined") return;
    void caches.keys().then((names) => {
      for (const n of names) {
        if (n.startsWith("bf-pages-")) void caches.delete(n);
      }
    }).catch(() => {});
  } catch {
    // CacheStorage unavailable (SSR / insecure context) — nothing to purge.
  }
}

export function purgeOfflineCache(tenantId?: string | null): void {
  if (tenantId) {
    for (const key of readIndex(tenantId)) safeLocal.remove(key);
    safeLocal.remove(indexKey(tenantId));
    return;
  }
  // No tenant given: sweep all bf_offline_v1_* keys across the store.
  // We can't rely on per-tenant indexes here (we don't know the tenant ids),
  // so iterate localStorage directly, guarded against throwing environments.
  try {
    const store = window.localStorage;
    const toRemove: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) safeLocal.remove(k);
  } catch {
    // localStorage unavailable (SSR / private mode) — nothing to purge.
  }
}
