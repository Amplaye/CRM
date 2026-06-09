-- ============================================================================
-- BILLING / SUBSCRIPTIONS  (Settings → Payments)
-- ============================================================================
-- Two tables, same security shape as the POS pair:
--   • subscriptions      — one row per tenant: the active plan, cycle, status,
--                          add-ons and the provider reference ids. NON-secret;
--                          members may read it (RLS), the webhooks write it via
--                          service-role. Mirrored cheaply into tenants.settings.billing
--                          so the CRM knows the plan at boot without a provider call.
--   • payment_secrets    — encrypted provider API material (e.g. a per-tenant
--                          Stripe Connect token, or PayPal client secret if ever
--                          stored per-tenant). AES-256-GCM, service-role/admin ONLY,
--                          NO member policy — identical to pos_credentials.
--
-- The PLATFORM Stripe/PayPal keys (ours, used for the standard checkout) live in
-- Vercel env, not here. payment_secrets only matters for per-tenant provider
-- material, kept future-proof and encrypted from day one.
-- ============================================================================

create table if not exists public.subscriptions (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan text check (plan in ('premium','business') or plan is null),
  cycle text check (cycle in ('monthly','yearly') or cycle is null),
  status text not null default 'incomplete'
    check (status in ('active','trialing','past_due','canceled','incomplete')),
  provider text check (provider in ('stripe','paypal') or provider is null),
  -- Provider reference ids (NOT secrets).
  stripe_customer_id text,
  stripe_subscription_id text,
  paypal_subscription_id text,
  -- Add-on ids currently subscribed (subset of catalog AddonId).
  addons text[] not null default '{}',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One active subscription record per tenant (upsert target).
  constraint uq_subscriptions_tenant unique (tenant_id)
);
create index if not exists idx_subscriptions_tenant on public.subscriptions(tenant_id);
create index if not exists idx_subscriptions_stripe_sub on public.subscriptions(stripe_subscription_id);
create index if not exists idx_subscriptions_paypal_sub on public.subscriptions(paypal_subscription_id);

create table if not exists public.payment_secrets (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('stripe','paypal')),
  secret_enc text not null,                          -- AES-256-GCM (PAYMENT_CRED_ENC_KEY || POS_CRED_ENC_KEY)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_payment_secrets_tenant_provider unique (tenant_id, provider)
);
create index if not exists idx_payment_secrets_tenant on public.payment_secrets(tenant_id);

-- ---- RLS ----
alter table public.subscriptions enable row level security;
alter table public.payment_secrets enable row level security;

-- subscriptions: members read-only (webhooks write via service-role).
create policy "subscriptions tenant read" on public.subscriptions
  for select using (private.is_tenant_member(tenant_id));
create policy "subscriptions admin access" on public.subscriptions
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- payment_secrets: NO member policy (service-role + admin only), like pos_credentials.
create policy "payment_secrets admin access" on public.payment_secrets
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
