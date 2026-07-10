-- ============================================================================
-- LOYALTY (punti/premi) — 2026-07-10
-- ============================================================================
-- Fase 6 of the all-inclusive plan. Points accrue when a reservation reaches
-- status 'completed' (hook in updateReservationDetailsAction, service role);
-- staff redeems a reward from the guest panel (/api/loyalty/redeem), which
-- writes a negative event and decrements the balance. Config lives in
-- tenants.settings.loyalty (points_per_visit, reward_points, reward_label).
--
--   • One account per (tenant, guest); events are the audit ledger.
--   • uq_loyalty_events_accrual_reservation makes the completed-hook
--     idempotent: flipping a reservation to completed twice can't double-earn.
--   • Writes via service role only; members read.
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

create table if not exists public.loyalty_accounts (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  points integer not null default 0 check (points >= 0),
  updated_at timestamptz not null default now(),
  constraint uq_loyalty_accounts unique (tenant_id, guest_id)
);

create index if not exists idx_loyalty_accounts_tenant
  on public.loyalty_accounts (tenant_id, points desc);

create table if not exists public.loyalty_events (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  -- positive = accrual, negative = redemption
  points_delta integer not null check (points_delta <> 0),
  reason text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_loyalty_events_tenant
  on public.loyalty_events (tenant_id, created_at desc);
create index if not exists idx_loyalty_events_guest
  on public.loyalty_events (guest_id, created_at desc);

-- Accrual idempotency: at most ONE positive event per reservation.
create unique index if not exists uq_loyalty_events_accrual_reservation
  on public.loyalty_events (reservation_id)
  where reservation_id is not null and points_delta > 0;

alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_events enable row level security;

drop policy if exists "loyalty_accounts member read" on public.loyalty_accounts;
create policy "loyalty_accounts member read" on public.loyalty_accounts
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

drop policy if exists "loyalty_events member read" on public.loyalty_events;
create policy "loyalty_events member read" on public.loyalty_events
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
