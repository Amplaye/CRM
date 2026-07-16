-- ============================================================================
-- EMAIL BYO-KEY + MONTHLY SEND LOG — 2026-07-13
-- ============================================================================
-- Optional per-tenant Resend account. By default a tenant sends through the
-- platform's shared RESEND_API_KEY (Steward pays); if it pastes its OWN Resend
-- key here, its sends go out on its own free-tier quota instead.
--
--   • email_secrets      — same shape/RLS as payment_secrets: AES-256-GCM blob,
--                          service-role only (no member policy — a member SELECT
--                          would hand the browser a live API key).
--   • email_send_log     — one row per email actually accepted by Resend, so the
--                          monthly counter covers BOTH campaign and transactional
--                          sends (campaign_recipients only knows about campaigns).
--
-- Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

create table if not exists public.email_secrets (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'resend' check (provider in ('resend')),
  secret_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_email_secrets_tenant_provider unique (tenant_id, provider)
);
create index if not exists idx_email_secrets_tenant on public.email_secrets(tenant_id);

alter table public.email_secrets enable row level security;
-- No member policy on purpose: only the service-role client ever reads this.

-- Send ledger. `kind` splits the two Resend quotas the counter reports against:
--   marketing     → campaign sends (Resend free tier: 1.000 contacts/month)
--   transactional → everything else (deposit link, gift card, follow-up…)
create table if not exists public.email_send_log (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null default 'transactional' check (kind in ('marketing','transactional')),
  -- true → sent on the tenant's OWN Resend key, false → platform shared pool.
  own_key boolean not null default false,
  sent_at timestamptz not null default now()
);

-- The counter always asks "this tenant, this month" — index matches that exactly.
create index if not exists idx_email_send_log_tenant_sent
  on public.email_send_log (tenant_id, sent_at desc);

alter table public.email_send_log enable row level security;

drop policy if exists "email_send_log member read" on public.email_send_log;
create policy "email_send_log member read" on public.email_send_log
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
