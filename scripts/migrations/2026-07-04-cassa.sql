-- ============================================================================
-- CASSA NATIVA (built-in restaurant POS) — 2026-07-04
-- ============================================================================
-- The CRM's own till: open a bill per table (or counter/takeaway), fire
-- comande, take payments, number receipts, run the daily cash session.
--
-- Design notes:
--   • Namespaced cassa_* — the pos_* tables stay owned by the EXTERNAL till
--     bridge (src/lib/pos). On payment the cassa also writes a canonical row
--     into pos_sales/pos_sale_items (provider = 'cassa'), so food cost, P&L
--     and menu engineering pick native sales up with zero changes.
--   • Members get SELECT only (like pos_sales): every write goes through the
--     /api/cassa routes (service role) so money records can't be edited from
--     the browser console.
--   • Receipt numbers are per-tenant per-year via fn_cassa_next_receipt
--     (upsert on cassa_counters → concurrency-safe, gapless assignment).
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Daily cash session (giornata di cassa)
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_sessions (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  opened_by uuid,
  opened_by_name text,
  opening_float numeric(10,2) not null default 0,   -- fondo cassa
  closed_at timestamptz,
  closed_by uuid,
  expected_cash numeric(10,2),                      -- float + cash takings, computed at close
  counted_cash numeric(10,2),                       -- what the drawer actually held
  cash_difference numeric(10,2),                    -- counted − expected
  totals jsonb not null default '{}'::jsonb,        -- frozen summary written at close
  notes text,
  created_at timestamptz not null default now()
);

-- One open session per tenant at a time.
create unique index if not exists uq_cassa_sessions_open
  on public.cassa_sessions (tenant_id) where (status = 'open');

create index if not exists idx_cassa_sessions_tenant
  on public.cassa_sessions (tenant_id, opened_at desc);

-- ---------------------------------------------------------------------------
-- 2) Orders (conti) — one live bill per table / counter sale / takeaway
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_orders (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid references public.cassa_sessions(id) on delete set null,
  table_id uuid references public.restaurant_tables(id) on delete set null,
  table_name text not null default '',              -- label snapshot ("Tavolo 4", "Banco"…)
  channel text not null default 'sala' check (channel in ('sala','asporto','delivery')),
  status text not null default 'open' check (status in ('open','paid','cancelled','void')),
  covers integer not null default 0,
  cover_unit numeric(10,2) not null default 0,      -- coperto per person (snapshot)
  discount_type text check (discount_type in ('percent','amount') or discount_type is null),
  discount_value numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,        -- denormalized, recomputed server-side
  total numeric(10,2) not null default 0,
  notes text,
  opened_by uuid,
  opened_by_name text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  receipt_number integer,                           -- assigned at payment
  receipt_year integer,
  receipt_date date,                                -- business date in the venue tz
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cassa_orders_tenant_status
  on public.cassa_orders (tenant_id, status);
create index if not exists idx_cassa_orders_tenant_receipt_date
  on public.cassa_orders (tenant_id, receipt_date desc);
create index if not exists idx_cassa_orders_session
  on public.cassa_orders (session_id);

-- ---------------------------------------------------------------------------
-- 3) Order lines (righe comanda)
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_order_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.cassa_orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,                               -- snapshot: survives menu edits
  unit_price numeric(10,2) not null default 0,      -- snapshot: survives price changes
  qty numeric(10,2) not null default 1 check (qty > 0),
  course integer not null default 1,                -- portata (1ª, 2ª, 3ª…)
  comanda_no integer not null default 1,            -- firing round the line went out with
  notes text,
  status text not null default 'sent' check (status in ('sent','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_cassa_order_items_order
  on public.cassa_order_items (order_id);
create index if not exists idx_cassa_order_items_tenant
  on public.cassa_order_items (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4) Payments — several rows per order = split bill / mixed methods
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_payments (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.cassa_orders(id) on delete cascade,
  method text not null check (method in ('cash','card','online','meal_voucher','bank_transfer','other')),
  amount numeric(10,2) not null,                    -- applied to the bill
  received numeric(10,2),                           -- cash tendered (change = received − amount)
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_cassa_payments_order
  on public.cassa_payments (order_id);
create index if not exists idx_cassa_payments_tenant
  on public.cassa_payments (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Receipt numbering — per tenant, per year, gapless & concurrency-safe
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  year integer not null,
  last_number integer not null default 0,
  primary key (tenant_id, year)
);

create or replace function public.fn_cassa_next_receipt(p_tenant_id uuid, p_year integer)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_next integer;
begin
  insert into public.cassa_counters (tenant_id, year, last_number)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, year)
  do update set last_number = cassa_counters.last_number + 1
  returning last_number into v_next;
  return v_next;
end $$;

revoke execute on function public.fn_cassa_next_receipt(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) RLS — members read, service role writes (via /api/cassa), admins full
-- ---------------------------------------------------------------------------
alter table public.cassa_sessions enable row level security;
alter table public.cassa_orders enable row level security;
alter table public.cassa_order_items enable row level security;
alter table public.cassa_payments enable row level security;
alter table public.cassa_counters enable row level security;

drop policy if exists "cassa_sessions tenant read" on public.cassa_sessions;
create policy "cassa_sessions tenant read" on public.cassa_sessions
  for select using (private.is_tenant_member(tenant_id));
drop policy if exists "cassa_orders tenant read" on public.cassa_orders;
create policy "cassa_orders tenant read" on public.cassa_orders
  for select using (private.is_tenant_member(tenant_id));
drop policy if exists "cassa_order_items tenant read" on public.cassa_order_items;
create policy "cassa_order_items tenant read" on public.cassa_order_items
  for select using (private.is_tenant_member(tenant_id));
drop policy if exists "cassa_payments tenant read" on public.cassa_payments;
create policy "cassa_payments tenant read" on public.cassa_payments
  for select using (private.is_tenant_member(tenant_id));
-- cassa_counters: no member policy (service-role only), admin below.

drop policy if exists "cassa_sessions admin access" on public.cassa_sessions;
create policy "cassa_sessions admin access" on public.cassa_sessions
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "cassa_orders admin access" on public.cassa_orders;
create policy "cassa_orders admin access" on public.cassa_orders
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "cassa_order_items admin access" on public.cassa_order_items;
create policy "cassa_order_items admin access" on public.cassa_order_items
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "cassa_payments admin access" on public.cassa_payments;
create policy "cassa_payments admin access" on public.cassa_payments
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "cassa_counters admin access" on public.cassa_counters;
create policy "cassa_counters admin access" on public.cassa_counters
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 7) Realtime — the /cassa screen live-updates across devices
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cassa_orders'
  ) then
    alter publication supabase_realtime add table public.cassa_orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cassa_order_items'
  ) then
    alter publication supabase_realtime add table public.cassa_order_items;
  end if;
end $$;
