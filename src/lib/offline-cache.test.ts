import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  writeOfflineCache,
  readOfflineCache,
  purgeOfflineCache,
  writeOfflineTenantCtx,
  readOfflineTenantCtx,
  purgeOfflinePages,
} from "./offline-cache";

// The test env is "node" (no DOM), and safe-storage bails when `window` is
// absent. Install a minimal in-memory localStorage on a global `window` so the
// real read/write/purge logic runs.
class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return Array.from(this.m.keys())[i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

function installStorage(storage: MemStorage) {
  (globalThis as any).window = { localStorage: storage };
}

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

describe("offline-cache", () => {
  beforeEach(() => {
    installStorage(new MemStorage());
  });

  it("round-trips data with a cachedAt timestamp", () => {
    writeOfflineCache(TENANT_A, "menu", [{ id: "1", name: "Pizza" }]);
    const got = readOfflineCache<{ id: string; name: string }[]>(TENANT_A, "menu");
    expect(got).not.toBeNull();
    expect(got!.data).toEqual([{ id: "1", name: "Pizza" }]);
    expect(typeof got!.cachedAt).toBe("number");
  });

  it("isolates tenants: tenant A's cache is never returned for tenant B", () => {
    writeOfflineCache(TENANT_A, "tables", [{ id: "t1" }]);
    expect(readOfflineCache(TENANT_B, "tables")).toBeNull();
    expect(readOfflineCache(TENANT_A, "tables")).not.toBeNull();
  });

  it("keys reservations by date", () => {
    writeOfflineCache(TENANT_A, "reservations", [{ id: "r1" }], "2026-07-07");
    expect(readOfflineCache(TENANT_A, "reservations", "2026-07-07")).not.toBeNull();
    // A different day is a distinct cache entry.
    expect(readOfflineCache(TENANT_A, "reservations", "2026-07-06")).toBeNull();
  });

  it("never caches empty or absent results (a failed fetch must not poison the cache)", () => {
    writeOfflineCache(TENANT_A, "menu", [{ id: "1" }]); // seed good data
    writeOfflineCache(TENANT_A, "menu", []); // empty result — must be ignored
    writeOfflineCache(TENANT_A, "menu", null as any); // absent — must be ignored
    const got = readOfflineCache<{ id: string }[]>(TENANT_A, "menu");
    expect(got!.data).toEqual([{ id: "1" }]); // still the seeded data
  });

  it("purges only bf_offline_v1_* keys for a given tenant", () => {
    installStorage(new MemStorage());
    const store = (globalThis as any).window.localStorage as MemStorage;
    store.setItem("unrelated_key", "keep-me");
    writeOfflineCache(TENANT_A, "menu", [{ id: "1" }]);
    writeOfflineCache(TENANT_B, "menu", [{ id: "2" }]);

    purgeOfflineCache(TENANT_A);

    expect(readOfflineCache(TENANT_A, "menu")).toBeNull();
    expect(readOfflineCache(TENANT_B, "menu")).not.toBeNull(); // other tenant untouched
    expect(store.getItem("unrelated_key")).toBe("keep-me"); // unrelated keys untouched
  });

  it("purges every tenant's offline cache when no tenant is given (logout)", () => {
    installStorage(new MemStorage());
    const store = (globalThis as any).window.localStorage as MemStorage;
    store.setItem("app_lang_v2", "it");
    writeOfflineCache(TENANT_A, "menu", [{ id: "1" }]);
    writeOfflineCache(TENANT_B, "tables", [{ id: "2" }]);

    purgeOfflineCache();

    expect(readOfflineCache(TENANT_A, "menu")).toBeNull();
    expect(readOfflineCache(TENANT_B, "tables")).toBeNull();
    expect(store.getItem("app_lang_v2")).toBe("it"); // non-offline keys survive
  });

  it("does not throw when storage writes fail (quota / private mode)", () => {
    const throwing = new MemStorage();
    vi.spyOn(throwing, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    installStorage(throwing);
    // Should swallow and simply not cache.
    expect(() => writeOfflineCache(TENANT_A, "menu", [{ id: "1" }])).not.toThrow();
    expect(readOfflineCache(TENANT_A, "menu")).toBeNull();
  });

  it("no-ops without a tenant id", () => {
    expect(() => writeOfflineCache(null, "menu", [{ id: "1" }])).not.toThrow();
    expect(readOfflineCache(undefined, "menu")).toBeNull();
  });

  it("round-trips the tenant context snapshot per user", () => {
    const snap = { globalRole: "user", tenants: [{ id: "t1" }], activeTenant: { id: "t1" }, activeRole: "owner", isImpersonating: false };
    writeOfflineTenantCtx("user-1", snap);
    expect(readOfflineTenantCtx("user-1")).toEqual(snap);
    expect(readOfflineTenantCtx("user-2")).toBeNull(); // per-user isolation
    expect(readOfflineTenantCtx(null)).toBeNull();
  });

  it("the logout purge also sweeps the tenant context snapshot", () => {
    writeOfflineTenantCtx("user-1", { tenants: [{ id: "t1" }] });
    purgeOfflineCache(); // no-arg = logout sweep of all bf_offline_v1_* keys
    expect(readOfflineTenantCtx("user-1")).toBeNull();
  });

  it("purgeOfflinePages deletes only bf-pages-* caches and never throws without CacheStorage", () => {
    // node env: no `caches` global — must be a silent no-op.
    expect(() => purgeOfflinePages()).not.toThrow();

    const deleted: string[] = [];
    (globalThis as any).caches = {
      keys: () => Promise.resolve(["bf-pages-v2", "bf-static-v2", "bf-shell-v2"]),
      delete: (n: string) => { deleted.push(n); return Promise.resolve(true); },
    };
    purgeOfflinePages();
    return Promise.resolve().then(() => {
      expect(deleted).toEqual(["bf-pages-v2"]); // static/shell caches untouched
      delete (globalThis as any).caches;
    });
  });
});
