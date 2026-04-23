// Safe wrappers around localStorage / sessionStorage.
// Safari Private Browsing / disabled storage / quota exceeded all throw;
// unguarded reads and writes crash the whole page.
// Reads return null on failure, writes/removes swallow the error.

type Storage = "local" | "session";

function getStore(kind: Storage): globalThis.Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export const safeStorage = {
  get(kind: Storage, key: string): string | null {
    const s = getStore(kind);
    if (!s) return null;
    try { return s.getItem(key); } catch { return null; }
  },
  set(kind: Storage, key: string, value: string): void {
    const s = getStore(kind);
    if (!s) return;
    try { s.setItem(key, value); } catch { /* quota / private mode */ }
  },
  remove(kind: Storage, key: string): void {
    const s = getStore(kind);
    if (!s) return;
    try { s.removeItem(key); } catch { /* ignore */ }
  },
};

export const safeLocal = {
  get: (key: string) => safeStorage.get("local", key),
  set: (key: string, value: string) => safeStorage.set("local", key, value),
  remove: (key: string) => safeStorage.remove("local", key),
};

export const safeSession = {
  get: (key: string) => safeStorage.get("session", key),
  set: (key: string, value: string) => safeStorage.set("session", key, value),
  remove: (key: string) => safeStorage.remove("session", key),
};
