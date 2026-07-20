// Shared plumbing for the CRM → POS write-back routes (push-price, push-product,
// push-stock). Each route does the SAME three things before it can touch a till:
//   1. authenticate the caller (cookie session)
//   2. prove they're a member of the tenant that owns the row they're editing
//   3. resolve that tenant's active connection + a ready-to-use adapter context
// Centralised here so the routes stay tiny and the ownership check can't drift
// between them. Mirrors the auth shape already used by /api/pos/push-price.

import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/pos/registry";
import { decryptCredentials } from "@/lib/pos/credentials";
import { getPosProvider } from "@/lib/pos/pos-provider";
import { verifyTenantMembership } from "@/lib/tenant-membership";
import type { PosAdapter, PosProvider } from "@/lib/pos/types";

export type TillCtx = { tenantId: string; credentials: Record<string, unknown>; config: Record<string, unknown> };

/** A till we can actually push to: adapter and context are both present. */
export interface ConnectedTill {
  provider: PosProvider;
  adapter: PosAdapter;
  ctx: TillCtx;
}

/** Nothing to push to — no active connection, 'mock', or the built-in till
 * (which has no adapter at all). Callers report "not connected". */
export interface UnconnectedTill {
  provider: PosProvider;
  adapter: PosAdapter | null;
  ctx: null;
}

/** Discriminated on `ctx`, so the existing `if (!till.ctx) …` guards narrow
 * `adapter` to non-null for free — no non-null assertions at the call sites. */
export type TillTarget = ConnectedTill | UnconnectedTill;

/** Resolve the calling user and assert they may act on `tenantId` — a member OR a
 * platform admin (who can manage any client, incl. while impersonating from the
 * admin panel). Returns the service-role client on success, or an error code the
 * route maps to an HTTP status. Service role is needed downstream to read
 * pos_credentials. Delegates to the canonical verifyTenantMembership so the
 * platform-admin rule stays in ONE place. */
export async function authorizeTenant(
  tenantId: string,
): Promise<{ svc: ReturnType<typeof createServiceRoleClient> } | { error: "unauthorized" | "forbidden" }> {
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { error: "unauthorized" };

  const allowed = await verifyTenantMembership(tenantId);
  if (!allowed) return { error: "forbidden" };
  return { svc: createServiceRoleClient() };
}

/** Build the till target for a tenant: its active provider, the adapter, and a
 * decrypted adapter context (or null when there's no active real connection).
 * `mock` always yields ctx=null — there's nothing to write to. */
export async function resolveTill(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  tenantId: string,
): Promise<TillTarget> {
  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  const provider = getPosProvider(tenant?.settings);
  // The built-in till has no adapter and nothing to push to: it reads the CRM's
  // own menu directly, so a price edit is already live the moment it is saved.
  // Return before getAdapter(), which throws on any provider without one.
  if (provider === "cassa") return { provider, adapter: null, ctx: null };
  const adapter = getAdapter(provider);
  if (provider === "mock") return { provider, adapter, ctx: null };

  const { data: conn } = await svc
    .from("pos_connections")
    .select("id, config")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .eq("active", true)
    .maybeSingle();
  if (!conn) return { provider, adapter, ctx: null };

  const credentials = await decryptCredentials(svc, conn.id);
  return {
    provider,
    adapter,
    ctx: { tenantId, credentials, config: (conn.config as Record<string, unknown>) || {} },
  };
}

/** Standard "pos" sub-object the write-back routes return, so the UI can show one
 * consistent message whether the till got the change, isn't connected, or the
 * provider can't do this write yet. */
export interface PosOutcome {
  attempted: boolean;
  ok: boolean;
  detail: string;
}

export function notConnected(provider: PosProvider): PosOutcome {
  return {
    attempted: false,
    ok: false,
    detail:
      provider === "mock"
        ? "Cassa demo: nessun invio."
        : "Nessuna connessione cassa attiva (collega la cassa in Impostazioni → Cassa).",
  };
}

export function notSupported(): PosOutcome {
  return { attempted: false, ok: false, detail: "Questa cassa non supporta ancora questa scrittura." };
}
