import { NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import { getAdapter } from "@/lib/pos/registry";
import { encryptCredentials } from "@/lib/pos/credentials";
import { applyPosProvider } from "@/lib/pos/pos-provider";
import { syncConnection, type PosConnectionRow } from "@/lib/pos/sync";
import type { PosProvider } from "@/lib/pos/types";

// Self-service POS connection — the piece that lets a NON-technical owner connect
// their till from Settings → Cassa instead of us running a script. Three actions:
//   • test  { provider, token, store_id? }     → just verify the token works
//     (calls adapter.testConnection with the pasted creds; saves nothing).
//   • save  { provider, token, store_id? }      → upsert pos_connections +
//     encrypted pos_credentials, flip settings.pos.provider, return the test
//     result. After this the dashboard reads the real till.
//   • sync  {}                                  → run a sync now ("Sincronizza
//     ora"): pull the latest sales into the canonical tables.
//
// User-authenticated (cookie) + ownership-checked. Secrets are encrypted at rest
// in pos_credentials (never in tenants.settings — the browser can read settings).
//
// Body: { tenant_id, action, provider?, token?, store_id? }
type Action = "test" | "save" | "sync";
const REAL_PROVIDERS: PosProvider[] = ["loyverse", "cassa_in_cloud", "tilby", "ipratico", "nempos", "deliverect"];

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const tenantId: string | undefined = body?.tenant_id || undefined;
  const action: Action | undefined = body?.action;
  if (!tenantId) return NextResponse.json({ error: "tenant_id_required" }, { status: 400 });
  if (action !== "test" && action !== "save" && action !== "sync") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }
  const svc = auth.svc;

  // ---- SYNC NOW: run the orchestrator against the active connection ----------
  if (action === "sync") {
    const { data: conn } = await svc
      .from("pos_connections")
      .select("id, tenant_id, provider, active, config, last_sync_at")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .maybeSingle();
    if (!conn) return NextResponse.json({ error: "no_active_connection" }, { status: 400 });
    const result = await syncConnection(svc, conn as PosConnectionRow);
    return NextResponse.json({ ok: result.status === "ok", result });
  }

  // test + save both need a provider and a token.
  const provider = body?.provider as PosProvider | undefined;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const storeId = typeof body?.store_id === "string" ? body.store_id.trim() : "";
  if (!provider || !REAL_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }
  if (!token) return NextResponse.json({ error: "token_required" }, { status: 400 });

  const adapter = getAdapter(provider);
  const config: Record<string, unknown> = storeId ? { store_id: storeId } : {};
  const ctx = { tenantId, credentials: { access_token: token }, config };

  // Verify the token before we save anything — a clear failure beats a silently
  // broken connection the owner only discovers when the dashboard stays empty.
  let test: { ok: boolean; detail?: string };
  try {
    test = await adapter.testConnection(ctx);
  } catch (e: any) {
    return NextResponse.json({ ok: false, test: { ok: false, detail: e?.message || String(e) } });
  }

  if (action === "test") {
    return NextResponse.json({ ok: test.ok, test });
  }

  // ---- SAVE: upsert connection + encrypted credentials, flip the provider ----
  // One active connection per (tenant, provider). Reuse an existing row so the
  // credentials/store update in place instead of creating duplicates.
  const { data: existing } = await svc
    .from("pos_connections")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();

  let connectionId = existing?.id as string | undefined;
  const now = new Date().toISOString();
  if (connectionId) {
    await svc
      .from("pos_connections")
      .update({ active: true, config, last_sync_status: null, last_error: null, updated_at: now })
      .eq("id", connectionId);
  } else {
    const { data: conn, error: connErr } = await svc
      .from("pos_connections")
      .insert({ tenant_id: tenantId, provider, active: true, config })
      .select("id")
      .single();
    if (connErr || !conn) {
      return NextResponse.json({ error: connErr?.message || "connection_insert_failed" }, { status: 500 });
    }
    connectionId = conn.id;
  }

  // Encrypt + upsert the token (one row per connection).
  const secret_enc = encryptCredentials({ access_token: token });
  await svc
    .from("pos_credentials")
    .upsert({ tenant_id: tenantId, connection_id: connectionId, secret_enc, updated_at: now }, { onConflict: "connection_id" });

  // Flip settings.pos.provider so the whole app reads this till from now on.
  const { data: tenant } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
  const newSettings = applyPosProvider(tenant?.settings, provider);
  await svc.from("tenants").update({ settings: newSettings }).eq("id", tenantId);

  return NextResponse.json({ ok: true, connectionId, provider, test });
}
