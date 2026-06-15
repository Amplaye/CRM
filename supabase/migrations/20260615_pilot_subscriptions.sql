-- ============================================================================
-- PAID PILOT → SUBSCRIPTION  (BALI Flow go-to-market flow)
-- ============================================================================
-- A standalone table for the "14-day paid pilot that auto-continues into a
-- monthly subscription" flow. It is INTENTIONALLY separate from public.subscriptions:
--   • the pilot plans are 'founder'/'premium' (different ids + prices from the
--     self-serve catalog, whose constraint only allows 'premium'/'business');
--   • a pilot is sold to a PROSPECT who may not have a tenant/account yet, so
--     tenant_id is nullable and linked later at provisioning time.
--
-- Flow recap (see src/lib/billing/pilot.ts):
--   1. Checkout (mode=payment) charges €150 today + saves the card  → payment_status='paid'
--   2. Webhook creates a 14-day trialing subscription on the saved card
--   3. A −€150 customer-balance credit reduces ONLY the first real invoice
--      (founder €299→€149, premium €399→€249); the second invoice is full price.
--
-- Security shape mirrors payment_secrets: service-role (webhooks) writes, platform
-- admins read/manage; NO member policy (rows can exist before any tenant does).
-- ============================================================================

create table if not exists public.pilot_subscriptions (
  id uuid default uuid_generate_v4() primary key,
  -- Linked once the prospect is provisioned into a real tenant. NULL pre-account.
  tenant_id uuid references public.tenants(id) on delete set null,
  plan text not null check (plan in ('founder','premium')),

  -- Stripe reference ids (NOT secrets).
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,

  -- Billing details collected at Checkout (denormalized for admin visibility).
  customer_email text,
  customer_name text,
  business_name text,
  tax_id text,

  -- Money model, in cents, for auditability.
  pilot_fee_cents integer not null default 15000,
  first_month_credit_cents integer not null default 15000,

  -- Pilot window = the subscription's trial. Set when the sub is created.
  pilot_start timestamptz,
  pilot_end timestamptz,
  current_period_end timestamptz,

  -- subscription_status mirrors Stripe sub status (trialing/active/past_due/canceled/incomplete).
  subscription_status text not null default 'incomplete'
    check (subscription_status in ('incomplete','trialing','active','past_due','canceled')),
  -- payment_status tracks the MONEY: pilot fee + recurring invoices.
  payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','failed')),

  -- Cancellation (manual admin action before day 14 prevents the first charge).
  canceled boolean not null default false,
  canceled_at timestamptz,
  cancel_at_period_end boolean not null default false,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per Checkout Session (idempotency target for the webhook upsert).
create unique index if not exists uq_pilot_subscriptions_session
  on public.pilot_subscriptions(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index if not exists idx_pilot_subscriptions_customer on public.pilot_subscriptions(stripe_customer_id);
create index if not exists idx_pilot_subscriptions_sub on public.pilot_subscriptions(stripe_subscription_id);
create index if not exists idx_pilot_subscriptions_tenant on public.pilot_subscriptions(tenant_id);

-- ---- RLS: service-role + platform admin only (no member policy) ----
alter table public.pilot_subscriptions enable row level security;

create policy "pilot_subscriptions admin access" on public.pilot_subscriptions
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
