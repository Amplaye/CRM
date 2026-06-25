-- ============================================================================
-- WHATSAPP / META EMBEDDED SIGNUP — onboarding pipeline
-- ============================================================================
-- Adds the per-tenant WhatsApp connection pipeline used by the in-CRM
-- "Connect WhatsApp Business" (Meta Embedded Signup) flow.
--
-- Two NEW tables; existing tables are REUSED, not duplicated:
--   whatsapp_setups            -> the onboarding STATE MACHINE (one row / tenant):
--                                 the "is this number already on WhatsApp?" answer
--                                 + setup_status + last_error + concierge notes.
--   meta_whatsapp_connections  -> the connection RESULT (one row / tenant):
--                                 meta_business_id, waba_id, phone_number_id,
--                                 connection_status, last_error.
--
-- Reused (intentionally NOT recreated):
--   * raw webhook payloads      -> public.webhook_events
--   * inbound/outbound messages -> public.conversations
--   * errors / alerts           -> public.system_logs
-- so the spec's whatsapp_webhook_events / whatsapp_message_logs are not created.
--
-- SECRETS: the per-tenant Meta access token is NOT stored here. It goes into
-- tenants.secrets (a service-role-only JSONB column, same place as openai_key /
-- ai_secret / meta_access_token), which is the codebase's existing
-- "stored securely server-side" guarantee. meta_whatsapp_connections holds only
-- non-secret identifiers + status, so it is safe for tenant members to read.
--
-- The resolved phone_number_id is ALSO mirrored into
-- tenants.settings.whatsapp.from (by the API route) so src/lib/whatsapp/from.ts
-- makes the existing send path send from the tenant's own number, no code change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- whatsapp_setups — onboarding state machine
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_setups (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- answer to "Is this number already being used on WhatsApp?"
  phone_number_usage text not null default 'unknown'
    check (phone_number_usage in ('business_app', 'normal_whatsapp', 'new_number', 'unknown')),
  -- onboarding pipeline status
  setup_status text not null default 'not_started'
    check (setup_status in (
      'not_started',
      'waiting_for_meta_login',
      'embedded_signup_started',
      'meta_connected',
      'phone_connected',
      'webhook_verified',
      'templates_pending',
      'templates_submitted',
      'templates_approved',
      'test_message_ready',
      'test_message_sent',
      'live',
      'failed_needs_manual_help'
    )),
  last_error text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

create index if not exists idx_whatsapp_setups_status on public.whatsapp_setups(setup_status);

-- ---------------------------------------------------------------------------
-- meta_whatsapp_connections — connection result (identifiers + status only)
-- ---------------------------------------------------------------------------
create table if not exists public.meta_whatsapp_connections (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  meta_business_id text,
  waba_id text,
  phone_number_id text,
  token_type text,
  token_expires_at timestamptz,
  connection_status text not null default 'pending'
    check (connection_status in ('pending', 'connected', 'error', 'disconnected')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);

create index if not exists idx_meta_wa_conn_tenant on public.meta_whatsapp_connections(tenant_id);
create index if not exists idx_meta_wa_conn_waba on public.meta_whatsapp_connections(waba_id);
create index if not exists idx_meta_wa_conn_phone on public.meta_whatsapp_connections(phone_number_id);

-- ---------------------------------------------------------------------------
-- RLS — members READ their tenant's status; only platform admins (and the
-- service-role used by API routes, which bypasses RLS) WRITE. Mirrors the
-- pattern in 20260609_billing.sql.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_setups enable row level security;
alter table public.meta_whatsapp_connections enable row level security;

create policy "whatsapp_setups tenant read" on public.whatsapp_setups
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "whatsapp_setups admin write" on public.whatsapp_setups
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy "meta_wa_conn tenant read" on public.meta_whatsapp_connections
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "meta_wa_conn admin write" on public.meta_whatsapp_connections
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
