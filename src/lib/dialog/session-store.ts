// Per-phone session persistence — replaces the n8n `staticData` layer.
//
// The live workflow stores `sessions[phone]` (and pending caches) in n8n's
// runtime-resident `staticData`, which is volatile (lost on restart) and
// single-instance (no high-availability path). The migration plan
// (REFACTOR_DIAGNOSIS §5.2 + Risk #4) moves session state into
// `public.bot_sessions` so all instances see the same view.
//
// The three RPCs `try_acquire_bot_lock`, `release_bot_lock`,
// `commit_bot_session` already exist in the live DB (added when FIX B33/B39
// landed on 2026-05-06/12). They are not in `supabase-schema.sql` yet —
// adding them is Step 5 of the refactor.

import { createServiceRoleClient } from '@/lib/supabase/server';
import type { DialogSession } from './types';
import { emptySession } from './types';

const LOCK_TTL_MS = 5_000; // matches FIX B33's 1.8s wait + safety margin
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface AcquireResult {
  acquired: boolean;
  session: DialogSession;
  /** Token to pass to commit/release — opaque from caller's point of view */
  token: string;
}

/**
 * Acquire the per-phone session lock and load the current state. If no row
 * exists, an empty session is returned with `acquired = true`. If another
 * worker holds the lock, the caller should wait and retry (the n8n FIX B33
 * code retries once after ~1.8s).
 */
export async function acquireSession(phone: string): Promise<AcquireResult> {
  const supa = createServiceRoleClient();
  const token = crypto.randomUUID();

  const { data, error } = await supa.rpc('try_acquire_bot_lock', {
    p_phone: phone,
    p_lock_token: token,
    p_lock_ttl_ms: LOCK_TTL_MS,
  });

  if (error) {
    // Defensive: if the RPC isn't present in this environment, fall back to
    // a non-locking read so dev/test isn't blocked.
    return { acquired: false, session: emptySession(), token };
  }

  const row = (data || {}) as {
    acquired?: boolean;
    session_data?: DialogSession | null;
    updated_at?: string;
  };

  let session: DialogSession;
  if (row.session_data && typeof row.session_data === 'object') {
    session = mergeWithDefaults(row.session_data);
  } else {
    session = emptySession();
  }

  // TTL eviction — old sessions get a fresh start.
  const ttlExpired =
    Date.now() - new Date(row.updated_at || 0).getTime() > SESSION_TTL_MS;
  if (ttlExpired) {
    session = emptySession(session.lang);
  }

  return { acquired: Boolean(row.acquired), session, token };
}

/**
 * Write the updated session back to the DB and release the lock atomically.
 * Returns false if the lock was lost (token mismatch) — the caller should
 * skip the response and let the peer's commit win, mirroring FIX #7.
 */
export async function commitSession(
  phone: string,
  session: DialogSession,
  token: string,
): Promise<boolean> {
  const supa = createServiceRoleClient();
  session.lastUpdate = Date.now();
  const { data, error } = await supa.rpc('commit_bot_session', {
    p_phone: phone,
    p_lock_token: token,
    p_session_data: session,
  });
  if (error) return false;
  return Boolean(data);
}

/** Release the lock without writing (early-return paths in the controller). */
export async function releaseSession(
  phone: string,
  token: string,
): Promise<void> {
  const supa = createServiceRoleClient();
  await supa.rpc('release_bot_lock', { p_phone: phone, p_lock_token: token });
}

/**
 * Defensive merge: if the DB row was written by an older bot version, fill
 * any newly-introduced fields with their defaults so downstream code doesn't
 * dereference undefined. Only keys present in `emptySession()` are kept.
 */
function mergeWithDefaults(stored: Partial<DialogSession>): DialogSession {
  const base = emptySession((stored.lang as DialogSession['lang']) || 'es');
  return {
    ...base,
    ...stored,
    fields: { ...base.fields, ...(stored.fields || {}) },
    shadowNotes: Array.isArray(stored.shadowNotes) ? stored.shadowNotes : [],
    pendingModifyTopics: Array.isArray(stored.pendingModifyTopics)
      ? stored.pendingModifyTopics
      : [],
  };
}
