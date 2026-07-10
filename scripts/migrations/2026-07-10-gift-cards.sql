-- ============================================================================
-- GIFT CARDS (buoni regalo) — 2026-07-10
-- ============================================================================
-- Fase 5 of the all-inclusive plan. A guest buys a voucher on the public
-- /g/<slug> page (Stripe Checkout, mode:payment, IMMEDIATE capture — unlike
-- deposits there is nothing to hold: the money is the product). The Stripe
-- webhook (metadata.kind = "gift_card") generates the unique code, inserts the
-- row and emails it to the recipient. Redemption happens at the till: the
-- staff adds a "gift_card" payment entry with the code; /api/cassa/orders/
-- [id]/pay validates it, decrements balance_cents and records the redemption.
--
--   • code is globally unique (short human code, printed/typed at the till).
--   • uq stripe_checkout_session_id makes the webhook idempotent: a Stripe
--     re-delivery upserts the same voucher instead of minting a second one.
--   • Writes go through the service role only; members read their tenant's
--     vouchers in the dashboard.
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

create table if not exists public.gift_cards (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  balance_cents integer not null check (balance_cents >= 0),
  currency text not null default 'EUR',
  buyer_email text,
  recipient_email text,
  recipient_name text,
  message text not null default '',
  status text not null default 'active' check (status in ('active','redeemed','expired')),
  stripe_payment_intent_id text,
  stripe_checkout_session_id text unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gift_cards_tenant on public.gift_cards (tenant_id, created_at desc);

create table if not exists public.gift_card_redemptions (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  -- The cassa order the voucher paid (nullable: room for future manual redemptions).
  order_id uuid references public.cassa_orders(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_gift_card_redemptions_tenant
  on public.gift_card_redemptions (tenant_id, created_at desc);
create index if not exists idx_gift_card_redemptions_card
  on public.gift_card_redemptions (gift_card_id);

alter table public.gift_cards enable row level security;
alter table public.gift_card_redemptions enable row level security;

drop policy if exists "gift_cards member read" on public.gift_cards;
create policy "gift_cards member read" on public.gift_cards
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

drop policy if exists "gift_card_redemptions member read" on public.gift_card_redemptions;
create policy "gift_card_redemptions member read" on public.gift_card_redemptions
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- The till accepts the voucher as a PAYMENT METHOD (reuses split payments —
-- no new money math): widen the method checks on cassa_payments and pos_sales.
alter table public.cassa_payments drop constraint if exists cassa_payments_method_check;
alter table public.cassa_payments add constraint cassa_payments_method_check
  check (method in ('cash','card','online','meal_voucher','bank_transfer','gift_card','other'));

alter table public.pos_sales drop constraint if exists pos_sales_payment_method_check;
alter table public.pos_sales add constraint pos_sales_payment_method_check
  check (payment_method in ('cash','card','online','meal_voucher','bank_transfer','gift_card','other')
         or payment_method is null);
