// Persistence for the WhatsApp/Meta onboarding pipeline.
//
// Two stores, server-side only (service-role):
//   * whatsapp_setups            — the onboarding STATE MACHINE (status + usage)
//   * meta_whatsapp_connections  — the connection RESULT (identifiers + status)
//
// The access TOKEN is NOT written to meta_whatsapp_connections (member-readable).
// It goes into tenants.secrets.meta_access_token — the service-role-only column
// the rest of the platform already uses. Writing the token + phone_number_id +
// waba_id there ALSO wires up real sending: the n8n bot reads
// {meta_access_token, meta_phone_number_id} from tenants.secrets, and the CRM
// send path reads settings.whatsapp.from via resolveWhatsAppFrom(). So a
// connected tenant immediately sends from its own number.

import { createServiceRoleClient } from "@/lib/supabase/server";

export type SetupStatus =
  | "not_started"
  | "waiting_for_meta_login"
  | "embedded_signup_started"
  | "meta_connected"
  | "phone_connected"
  | "webhook_verified"
  | "templates_pending"
  | "templates_submitted"
  | "templates_approved"
  | "test_message_ready"
  | "test_message_sent"
  | "live"
  | "failed_needs_manual_help";

export type PhoneNumberUsage = "business_app" | "normal_whatsapp" | "new_number" | "unknown";

export type ConnectionStatus = "pending" | "connected" | "error" | "disconnected";

/** Upsert the tenant's onboarding state machine row. */
export async function upsertSetupStatus(
  tenantId: string,
  patch: {
    phoneNumberUsage?: PhoneNumberUsage;
    setupStatus?: SetupStatus;
    lastError?: string | null;
    notes?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceRoleClient();
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    updated_at: new Date().toISOString(),
  };
  if (patch.phoneNumberUsage !== undefined) row.phone_number_usage = patch.phoneNumberUsage;
  if (patch.setupStatus !== undefined) row.setup_status = patch.setupStatus;
  if (patch.lastError !== undefined) row.last_error = patch.lastError;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { error } = await supabase.from("whatsapp_setups").upsert(row, { onConflict: "tenant_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface StoreConnectionInput {
  tenantId: string;
  businessId?: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  /** Stored in tenants.secrets (service-role-only); never returned to the client. */
  accessToken?: string | null;
  tokenType?: string | null;
  /** seconds until expiry, when Meta returns it */
  expiresIn?: number | null;
  connectionStatus?: ConnectionStatus;
  lastError?: string | null;
}

/**
 * Persist a completed/updated Meta connection: the identifiers + status into
 * meta_whatsapp_connections, and the token + identifiers into tenants.secrets /
 * settings (so the send path works unchanged).
 */
export async function storeMetaConnection(input: StoreConnectionInput): Promise<{ ok: boolean; error?: string }> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();
  const tokenExpiresAt =
    input.expiresIn && input.expiresIn > 0 ? new Date(Date.now() + input.expiresIn * 1000).toISOString() : null;

  // 1) Connection row (no secret).
  const { error: connErr } = await supabase.from("meta_whatsapp_connections").upsert(
    {
      tenant_id: input.tenantId,
      meta_business_id: input.businessId ?? null,
      waba_id: input.wabaId ?? null,
      phone_number_id: input.phoneNumberId ?? null,
      token_type: input.tokenType ?? null,
      token_expires_at: tokenExpiresAt,
      connection_status: input.connectionStatus ?? "connected",
      last_error: input.lastError ?? null,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  if (connErr) return { ok: false, error: connErr.message };

  // 2) Token + identifiers into tenants.secrets (service-role-only), and mirror
  //    the sender number into settings.whatsapp.from + flip provisioning markers.
  const { data: cur, error: readErr } = await supabase
    .from("tenants")
    .select("secrets, settings")
    .eq("id", input.tenantId)
    .single();
  if (readErr) return { ok: false, error: readErr.message };

  const secrets: Record<string, unknown> = { ...((cur?.secrets as Record<string, unknown>) || {}) };
  if (input.accessToken) secrets.meta_access_token = input.accessToken;
  if (input.phoneNumberId) secrets.meta_phone_number_id = input.phoneNumberId;
  if (input.wabaId) secrets.meta_waba_id = input.wabaId;

  const settings: Record<string, unknown> = { ...((cur?.settings as Record<string, unknown>) || {}) };
  if (input.phoneNumberId) {
    settings.whatsapp = { ...((settings.whatsapp as Record<string, unknown>) || {}), from: input.phoneNumberId };
    settings.provisioning = {
      ...((settings.provisioning as Record<string, unknown>) || {}),
      whatsapp_attached: true,
      sandbox_routable: false,
    };
  }

  const { error: updErr } = await supabase.from("tenants").update({ secrets, settings }).eq("id", input.tenantId);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true };
}

export interface SetupView {
  setup: {
    phone_number_usage: PhoneNumberUsage;
    setup_status: SetupStatus;
    last_error: string | null;
    notes: string | null;
    updated_at: string | null;
  } | null;
  connection: {
    meta_business_id: string | null;
    waba_id: string | null;
    phone_number_id: string | null;
    connection_status: ConnectionStatus;
    last_error: string | null;
    updated_at: string | null;
  } | null;
}

/** Read both the setup state and the connection (no secret) for a tenant. */
export async function readSetupView(tenantId: string): Promise<SetupView> {
  const supabase = createServiceRoleClient();
  const [{ data: setup }, { data: connection }] = await Promise.all([
    supabase
      .from("whatsapp_setups")
      .select("phone_number_usage, setup_status, last_error, notes, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("meta_whatsapp_connections")
      .select("meta_business_id, waba_id, phone_number_id, connection_status, last_error, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  return { setup: (setup as SetupView["setup"]) ?? null, connection: (connection as SetupView["connection"]) ?? null };
}
