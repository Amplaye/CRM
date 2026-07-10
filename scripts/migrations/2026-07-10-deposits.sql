-- ============================================================================
-- BOOKING DEPOSITS (caparre) — 2026-07-10
-- ============================================================================
-- Real anti-no-show deposits on reservations (Fase 1 of the all-inclusive
-- plan). Stripe Checkout in mode:payment with capture_method:manual — the
-- card is AUTHORIZED (hold) when the guest pays the link, then the hold is
-- CAPTURED on no-show (forfeit) or CANCELLED on show-up (release). Feature
-- gate: settings.features.deposits_enabled + settings.venue.deposit_* config.
--
--   • reservations gains a deposit_* column family; 'none' = feature not
--     involved for that booking, so legacy rows need no backfill.
--   • reservation_payments is the money audit trail: one row per Stripe
--     movement (authorize / capture / cancel / refund), written ONLY by the
--     service role (webhook + resolve route). Members read, never write.
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

alter table public.reservations
  add column if not exists deposit_status text not null default 'none'
    check (deposit_status in ('none','required','pending','authorized','paid','forfeited','released','refunded')),
  add column if not exists deposit_amount_cents integer,
  add column if not exists deposit_currency text,
  add column if not exists deposit_payment_intent_id text,
  add column if not exists deposit_checkout_session_id text,
  add column if not exists deposit_paid_at timestamptz;

-- The webhook looks a reservation up by the Checkout Session it created.
create index if not exists idx_reservations_deposit_session
  on public.reservations (deposit_checkout_session_id)
  where deposit_checkout_session_id is not null;

create table if not exists public.reservation_payments (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  kind text not null default 'deposit' check (kind in ('deposit')),
  -- authorize / capture / cancel / refund — the raw movement, not the state.
  action text not null check (action in ('authorized','captured','cancelled','refunded','expired')),
  amount_cents integer not null,
  currency text not null default 'eur',
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reservation_payments_tenant
  on public.reservation_payments (tenant_id);
create index if not exists idx_reservation_payments_reservation
  on public.reservation_payments (reservation_id);

alter table public.reservation_payments enable row level security;

-- Members read their tenant's movements; ONLY the service role writes (the
-- Stripe webhook and the deposit resolve route) — no insert/update policies.
drop policy if exists "reservation_payments member read" on public.reservation_payments;
create policy "reservation_payments member read" on public.reservation_payments
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
