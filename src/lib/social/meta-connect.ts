// Meta connection for the Social section — the twin of whatsapp/embedded-signup.ts,
// specialised for Instagram + Facebook Page publishing.
//
// The flow is: the browser runs FB.login() with publishing scopes and hands us a
// short-lived `code`; the server exchanges it for a user token, lists the user's
// Facebook Pages (each Page carries its own long-lived Page token), and for the
// chosen Page reads the linked Instagram Business account id. The long-lived Page
// token is the credential we keep — it publishes to both the Page and its IG.
//
// Same never-throw → result-object contract as embedded-signup.ts. The secret
// token is written to tenants.secrets (service-role-only) by storeSocialConnection,
// never returned to the browser — exactly like meta_access_token for WhatsApp.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { exchangeCodeForToken } from "@/lib/whatsapp/embedded-signup";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** A Facebook Page the connecting user administers, with its linked IG account. */
export interface MetaPage {
  pageId: string;
  pageName?: string;
  /** Long-lived Page access token — the credential we publish with. SECRET. */
  pageAccessToken?: string;
  /** Instagram Business account id linked to the Page, when present. */
  igUserId?: string;
}

export interface ListPagesResult {
  ok: boolean;
  pages?: MetaPage[];
  error?: string;
}

/**
 * Exchange the FB.login code for a user token, then list the user's Pages with
 * their per-Page token and linked IG business account. Never throws.
 */
export async function listPagesFromCode(code: string): Promise<ListPagesResult> {
  const ex = await exchangeCodeForToken(code);
  if (!ex.ok || !ex.accessToken) return { ok: false, error: ex.error || "Token exchange failed" };
  return listPagesFromToken(ex.accessToken);
}

/** List Pages (with IG link) from an already-obtained user access token. Never throws. */
export async function listPagesFromToken(userToken: string): Promise<ListPagesResult> {
  try {
    const res = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}`,
      { headers: { Authorization: `Bearer ${userToken}` } },
    );
    const data = (await res.json().catch(() => ({}))) as {
      data?: Array<{
        id?: string;
        name?: string;
        access_token?: string;
        instagram_business_account?: { id?: string; username?: string };
      }>;
      error?: { message?: string };
    };
    if (!res.ok) return { ok: false, error: data?.error?.message || `Graph error ${res.status}` };
    const pages: MetaPage[] = (data.data || [])
      .filter((p) => p.id)
      .map((p) => ({
        pageId: p.id as string,
        pageName: p.name,
        pageAccessToken: p.access_token,
        igUserId: p.instagram_business_account?.id,
      }));
    return { ok: true, pages };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface StoreSocialConnectionInput {
  tenantId: string;
  page: MetaPage;
  /** Chosen targets — which of instagram/facebook this connection publishes to. */
  targets: Array<"instagram" | "facebook">;
  /** Seconds until the Page token expires, if Meta returned it (usually omitted
   * for long-lived Page tokens → null = no known expiry). */
  expiresIn?: number | null;
}

/**
 * Persist a completed social connection: identifiers + status into
 * social_accounts (member-readable, NO token), and the secret Page token +
 * IG/Page ids into tenants.secrets (service-role-only). Mirrors
 * storeMetaConnection for WhatsApp. Never throws.
 */
export async function storeSocialConnection(
  input: StoreSocialConnectionInput,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();
  const tokenExpiresAt =
    input.expiresIn && input.expiresIn > 0 ? new Date(Date.now() + input.expiresIn * 1000).toISOString() : null;

  // 1) social_accounts rows (no secret) — one per chosen platform.
  for (const platform of input.targets) {
    const { error: accErr } = await supabase.from("social_accounts").upsert(
      {
        tenant_id: input.tenantId,
        platform,
        account_name: input.page.pageName ?? null,
        ig_user_id: input.page.igUserId ?? null,
        page_id: input.page.pageId ?? null,
        token_expires_at: tokenExpiresAt,
        status: "connected",
        last_error: null,
        updated_at: now,
      },
      { onConflict: "tenant_id,platform" },
    );
    if (accErr) return { ok: false, error: accErr.message };
  }

  // 2) Secret Page token + identifiers into tenants.secrets (service-role-only).
  const { data: cur, error: readErr } = await supabase
    .from("tenants")
    .select("secrets")
    .eq("id", input.tenantId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  const secrets: Record<string, unknown> = { ...((cur?.secrets as Record<string, unknown>) || {}) };
  if (input.page.pageAccessToken) secrets.meta_page_token = input.page.pageAccessToken;
  if (input.page.igUserId) secrets.meta_ig_user_id = input.page.igUserId;
  if (input.page.pageId) secrets.meta_social_page_id = input.page.pageId;

  const { error: updErr } = await supabase.from("tenants").update({ secrets }).eq("id", input.tenantId);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true };
}

/** The service-role-only social secrets, read by the cron/publisher. */
export interface SocialSecrets {
  pageToken?: string;
  igUserId?: string;
  pageId?: string;
}

/** Read the tenant's social secrets from tenants.secrets (service-role only). */
export async function getSocialSecrets(
  tenantId: string,
  client?: ReturnType<typeof createServiceRoleClient>,
): Promise<SocialSecrets> {
  const svc = client ?? createServiceRoleClient();
  const { data } = await svc.from("tenants").select("secrets").eq("id", tenantId).maybeSingle();
  const s = (data?.secrets as Record<string, unknown>) || {};
  return {
    pageToken: typeof s.meta_page_token === "string" ? s.meta_page_token : undefined,
    igUserId: typeof s.meta_ig_user_id === "string" ? s.meta_ig_user_id : undefined,
    pageId: typeof s.meta_social_page_id === "string" ? s.meta_social_page_id : undefined,
  };
}

/** Remove a tenant's social connection: mark accounts revoked + drop the secrets. */
export async function disconnectSocial(tenantId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceRoleClient();
  const { error: accErr } = await supabase
    .from("social_accounts")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);
  if (accErr) return { ok: false, error: accErr.message };

  const { data: cur } = await supabase.from("tenants").select("secrets").eq("id", tenantId).single();
  const secrets: Record<string, unknown> = { ...((cur?.secrets as Record<string, unknown>) || {}) };
  delete secrets.meta_page_token;
  delete secrets.meta_ig_user_id;
  delete secrets.meta_social_page_id;
  const { error: updErr } = await supabase.from("tenants").update({ secrets }).eq("id", tenantId);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true };
}
