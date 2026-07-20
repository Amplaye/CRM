import { NextResponse } from "next/server";
import { authorizeTenant } from "@/lib/pos/write-back";
import { assertManagement } from "@/lib/billing/guard";
import { getAdapter } from "@/lib/pos/registry";
import { encryptCredentials } from "@/lib/pos/credentials";
import { applyPosProvider } from "@/lib/pos/pos-provider";
import { syncConnection, type PosConnectionRow } from "@/lib/pos/sync";
import { logSystemEvent } from "@/lib/system-log";
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
//   • switch {}                                 → move this tenant OFF its
//     external till and ONTO the built-in cassa. See below.
//
// User-authenticated (cookie) + ownership-checked. Secrets are encrypted at rest
// in pos_credentials (never in tenants.settings — the browser can read settings).
//
// THE SWITCH, and why it must be exclusive: pos_sales holds rows from every
// source, distinguished only by `provider`, and P&L/food-cost read that table
// with no provider filter. So a tenant ringing the same bill on Loyverse AND on
// /cassa gets it counted twice in revenue and depleted twice from stock — the
// unique key (tenant, provider, external_id) does not dedupe across providers.
// Exactly one till may therefore be live at a time. `switch` enforces that by
// deactivating the connection (the pos-sync cron selects on active=true and
// never consults settings.pos.provider, so flipping the setting alone would NOT
// stop Loyverse pulling) and then pointing settings at the built-in till.
//
// History is deliberately untouched: old provider='loyverse' rows stay in
// pos_sales forever and keep feeding P&L. The switch is a boundary in time, not
// a data migration — nothing is deleted, rewritten or re-tagged.
//
// Body: { tenant_id, action, provider?, token?, store_id? }
type Action = "test" | "save" | "sync" | "switch";
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
  if (action !== "test" && action !== "save" && action !== "sync" && action !== "switch") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const auth = await authorizeTenant(tenantId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "unauthorized" ? 401 : 403 });
  }
  const svc = auth.svc;
  // Paid add-on gate: the whole POS connection flow belongs to the gestionale.
  const gate = await assertManagement(tenantId, svc);
  if (gate) return gate;

  // ---- SWITCH TO THE BUILT-IN TILL ------------------------------------------
  // Order matters. Deactivate the external connection FIRST: if the settings
  // update fails afterwards we are left with "no till syncing", which is
  // recoverable and visible. The reverse order could leave Loyverse still
  // pulling while the app believes it is on cassa — the double-count state.
  if (action === "switch") {
    const now = new Date().toISOString();

    const { data: deactivated, error: deactErr } = await svc
      .from("pos_connections")
      .update({ active: false, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .select("id, provider");
    if (deactErr) {
      return NextResponse.json({ error: deactErr.message }, { status: 500 });
    }

    const { data: tenantRow } = await svc.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
    const switched = applyPosProvider(tenantRow?.settings, "cassa");
    const { error: setErr } = await svc.from("tenants").update({ settings: switched }).eq("id", tenantId);
    if (setErr) {
      return NextResponse.json({ error: setErr.message }, { status: 500 });
    }

    // Audit trail: which till the tenant left, and when. Best-effort — a logging
    // failure must not fail a switch that already succeeded.
    const from = (deactivated || []).map((c: { provider: string }) => c.provider).join(", ") || "none";
    try {
      await logSystemEvent({
        tenant_id: tenantId,
        category: "system",
        severity: "low",
        title: "Switched to the built-in till",
        description: `Deactivated external POS (${from}) and moved this tenant to the built-in cassa. Historical sales from the old till are retained.`,
        metadata: { switched_from: from, deactivated: (deactivated || []).length },
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ ok: true, switched_from: from, deactivated: (deactivated || []).length });
  }

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
