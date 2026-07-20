-- Per-batch expiry tracking (stock_lots).
--
-- ingredients.expiry_date is a single date, so two deliveries of the same
-- perishable with different use-by dates can't both be tracked. This adds a
-- lightweight lot ledger: every goods-in with a shelf life creates a lot
-- (received date, qty, expiry). Lots are an EXPIRY REMINDER per delivery batch —
-- they intentionally do NOT drive stock_qty or sale depletion (that stays on
-- stock_movements untouched). The owner closes a lot with one tap when the batch
-- is gone.
--
-- ingredients.expiry_date becomes a cache = earliest OPEN lot, kept in sync by a
-- trigger, so every existing badge/alert/UI keeps working with no change. The
-- trigger only touches ingredients that HAVE lots, so lot-free ingredients keep
-- their manual date.

create table if not exists public.stock_lots (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  qty numeric(14,3),
  unit text,
  expiry_date date not null,
  received_on date not null default current_date,
  source text not null default 'receipt' check (source in ('receipt','invoice','manual')),
  note text,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  ref_id uuid,                                  -- originating movement / invoice item
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_lots_ingredient_open on public.stock_lots(ingredient_id) where status = 'open';
create index if not exists idx_stock_lots_tenant on public.stock_lots(tenant_id, expiry_date);

-- Keep ingredients.expiry_date = earliest OPEN lot (or null when none remain).
create or replace function public.fn_sync_ingredient_expiry()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ingredient uuid := coalesce(NEW.ingredient_id, OLD.ingredient_id);
  v_tenant uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
  v_expiry date;
begin
  select min(expiry_date) into v_expiry
    from public.stock_lots
   where ingredient_id = v_ingredient and status = 'open';
  update public.ingredients set expiry_date = v_expiry, updated_at = now()
   where id = v_ingredient and tenant_id = v_tenant;
  return null;
end $$;
drop trigger if exists trg_sync_ingredient_expiry on public.stock_lots;
create trigger trg_sync_ingredient_expiry
  after insert or update or delete on public.stock_lots
  for each row execute function public.fn_sync_ingredient_expiry();

-- RLS — members full, platform admin full (mirror ingredients).
alter table public.stock_lots enable row level security;
drop policy if exists "stock_lots tenant access" on public.stock_lots;
create policy "stock_lots tenant access" on public.stock_lots
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
drop policy if exists "stock_lots admin access" on public.stock_lots;
create policy "stock_lots admin access" on public.stock_lots
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- Realtime (idempotent) — live lot list in the inventory UI.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_lots'
  ) then
    alter publication supabase_realtime add table public.stock_lots;
  end if;
end $$;
