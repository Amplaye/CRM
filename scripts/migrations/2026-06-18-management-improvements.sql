-- ============================================
-- 2026-06-18: Management improvements (inventory ledger, overhead, recipe yield)
-- ============================================
-- Builds on 2026-06-08-management-foodcost.sql. Adds the pieces the inventory /
-- food-cost / P&L screens were missing:
--   1. stock_movements  — an append-only ledger of every stock change (sale,
--      goods receipt, physical count, manual adjustment, waste), with a trigger
--      that keeps ingredients.stock_qty in sync. The single write path for stock.
--   2. fn_consume_stock_for_sale_item rewritten to log a 'sale' movement per
--      ingredient (the trigger applies it) instead of updating stock directly —
--      so automatic depletion now leaves an auditable trail.
--   3. overhead_costs — monthly fixed costs (rent, utilities…) so the P&L shows a
--      real operating margin, not just food + labor.
--   4. recipe_items.waste_pct — per-line yield loss (trim/cook-off) that grosses
--      up the costed quantity (food cost only; stock depletion stays at plated qty
--      so the count vs system variance still reveals real shrinkage).
--   5. supplier_invoice_items.received_at — marks an invoice line as carried into
--      stock (the invoices → warehouse seam), recorded as a 'receipt' movement.
--
-- Runs AFTER 2026-06-08-management-foodcost.sql.

-- ============================================
-- 1. Stock movements ledger
-- ============================================
create table if not exists public.stock_movements (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  -- signed: negative consumes, positive adds. A 'count' carries the correction
  -- (counted − system), so applying the delta lands stock on the counted value.
  qty_delta numeric(14,3) not null,
  kind text not null check (kind in ('sale','receipt','count','adjustment','waste')),
  reason text,
  -- snapshot of the ingredient unit cost when the movement happened, so the
  -- ledger can be valued (€) even after the cost later changes.
  unit_cost numeric(12,4),
  -- free reference to the originating row (sale item id, invoice item id…).
  ref_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_tenant_created
  on public.stock_movements(tenant_id, created_at desc);
create index if not exists idx_stock_movements_ingredient
  on public.stock_movements(ingredient_id, created_at desc);

-- Trigger: every movement applies its delta to the ingredient's stock. This is
-- the ONLY place stock_qty changes from a movement, so the ledger and the running
-- total never disagree.
create or replace function public.fn_apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ingredients
     set stock_qty = stock_qty + NEW.qty_delta, updated_at = now()
   where id = NEW.ingredient_id and tenant_id = NEW.tenant_id;
  return NEW;
end $$;
drop trigger if exists trg_apply_stock_movement on public.stock_movements;
create trigger trg_apply_stock_movement after insert on public.stock_movements
  for each row execute function public.fn_apply_stock_movement();

-- ============================================
-- 2. Rewrite sale depletion to go through the ledger
-- ============================================
-- Logs one 'sale' movement per recipe ingredient (negative delta = plated qty ×
-- units sold). Waste is deliberately NOT applied here: stock is depleted by the
-- plated quantity so the physical count vs system comparison surfaces real waste.
create or replace function public.fn_consume_stock_for_sale_item(
  p_tenant_id uuid, p_menu_item_id uuid, p_sold_qty numeric
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.stock_movements (tenant_id, ingredient_id, qty_delta, kind, reason, unit_cost)
  select p_tenant_id, ri.ingredient_id, -(ri.qty * p_sold_qty), 'sale', 'pos_sync', i.current_unit_cost
    from public.recipe_items ri
    join public.ingredients i on i.id = ri.ingredient_id and i.tenant_id = p_tenant_id
   where ri.menu_item_id = p_menu_item_id and ri.tenant_id = p_tenant_id;
end $$;
revoke execute on function public.fn_consume_stock_for_sale_item(uuid,uuid,numeric) from public, anon, authenticated;

-- ============================================
-- 3. Overhead costs (monthly fixed costs → real operating margin)
-- ============================================
create table if not exists public.overhead_costs (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- first day of the month the cost belongs to (e.g. 2026-06-01 for June).
  period_month date not null,
  category text not null,
  amount numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint overhead_costs_unique unique (tenant_id, period_month, category)
);
create index if not exists idx_overhead_costs_tenant_month
  on public.overhead_costs(tenant_id, period_month);

-- ============================================
-- 4. Recipe line yield loss (food-cost only)
-- ============================================
alter table public.recipe_items
  add column if not exists waste_pct numeric(5,2) not null default 0;

-- ============================================
-- 5. Invoice line → stock receipt seam
-- ============================================
alter table public.supplier_invoice_items
  add column if not exists received_at timestamptz;

-- ============================================
-- RLS — member full access + admin (private financials), mirrors part 2.
-- ============================================
alter table public.stock_movements enable row level security;
alter table public.overhead_costs enable row level security;

create policy "stock_movements tenant access" on public.stock_movements
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
create policy "overhead_costs tenant access" on public.overhead_costs
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

create policy "stock_movements admin access" on public.stock_movements
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "overhead_costs admin access" on public.overhead_costs
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- ============================================
-- Realtime (idempotent guard) — live movement history + inventory.
-- ============================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_movements'
  ) then
    alter publication supabase_realtime add table public.stock_movements;
  end if;
end $$;
