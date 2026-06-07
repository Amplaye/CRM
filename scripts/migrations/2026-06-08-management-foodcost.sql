-- ============================================
-- 2026-06-08: Management food cost / inventory / P&L (gestionale, part 2/2)
-- ============================================
-- Consumption layer. Reads the canonical POS tables from part 1 and adds the
-- restaurant-economics primitives: ingredients (with stock for inventory),
-- recipes (dish → ingredient quantities), light labor cost per shift, and an
-- append-only ingredient cost history fed by supplier invoices via a trigger.
-- Also closes the supplier_invoice_items.ingredient_id seam left open in part 1.
--
-- Runs AFTER 2026-06-08-pos-ingestion.sql.

-- ============================================
-- 1. Ingredients (current_unit_cost fed by invoices; stock for inventory)
-- ============================================
create table if not exists public.ingredients (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  unit text not null default 'g' check (unit in ('g','kg','ml','l','pz')),
  current_unit_cost numeric(12,4) not null default 0,   -- cost per `unit`
  stock_qty numeric(14,3) not null default 0,
  par_level numeric(14,3) not null default 0,           -- minimum-stock threshold
  expiry_date date,
  shelf_life_days integer,
  supplier_name text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingredients_name_per_tenant unique (tenant_id, name)
);
create index if not exists idx_ingredients_tenant on public.ingredients(tenant_id);
create index if not exists idx_ingredients_tenant_lowstock
  on public.ingredients(tenant_id) where stock_qty <= par_level;

-- ============================================
-- 2. Recipe items: dish = list of (ingredient, qty in the ingredient's unit)
-- ============================================
create table if not exists public.recipe_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  qty numeric(14,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_items_unique unique (menu_item_id, ingredient_id)
);
create index if not exists idx_recipe_items_menu_item on public.recipe_items(menu_item_id);
create index if not exists idx_recipe_items_ingredient on public.recipe_items(ingredient_id);
create index if not exists idx_recipe_items_tenant on public.recipe_items(tenant_id);

-- ============================================
-- 3. Labor cost: one row per (date, shift). NO per-employee HR.
-- ============================================
create table if not exists public.labor_cost (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_date date not null,
  shift text not null default 'all' check (shift in ('lunch','dinner','all')),
  cost numeric(12,2) not null default 0,
  hours numeric(8,2),
  staff_count integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labor_cost_unique unique (tenant_id, work_date, shift)
);
create index if not exists idx_labor_cost_tenant_date on public.labor_cost(tenant_id, work_date);

-- ============================================
-- 4. Ingredient cost history (append-only) = the seam with invoices
-- ============================================
create table if not exists public.ingredient_cost_history (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  unit_cost numeric(12,4) not null,
  source text not null default 'invoice' check (source in ('invoice','manual')),
  invoice_item_id uuid,
  observed_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists idx_ich_ingredient on public.ingredient_cost_history(ingredient_id, observed_on desc);
create index if not exists idx_ich_tenant on public.ingredient_cost_history(tenant_id);

-- ============================================
-- 5. Trigger: new cost-history row → update current_unit_cost
--    (last-price-wins; switch to weighted average by changing ONLY this function)
-- ============================================
create or replace function public.fn_apply_ingredient_cost()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ingredients set current_unit_cost = NEW.unit_cost, updated_at = now()
   where id = NEW.ingredient_id and tenant_id = NEW.tenant_id;
  return NEW;
end $$;
drop trigger if exists trg_apply_ingredient_cost on public.ingredient_cost_history;
create trigger trg_apply_ingredient_cost after insert on public.ingredient_cost_history
  for each row execute function public.fn_apply_ingredient_cost();

-- ============================================
-- 6. Function: deplete stock for one sold dish (ingestion calls it per line)
-- ============================================
create or replace function public.fn_consume_stock_for_sale_item(
  p_tenant_id uuid, p_menu_item_id uuid, p_sold_qty numeric
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ingredients i
     set stock_qty = i.stock_qty - (ri.qty * p_sold_qty), updated_at = now()
    from public.recipe_items ri
   where ri.menu_item_id = p_menu_item_id and ri.ingredient_id = i.id and i.tenant_id = p_tenant_id;
end $$;
revoke execute on function public.fn_consume_stock_for_sale_item(uuid,uuid,numeric) from public, anon, authenticated;

-- ============================================
-- 7. Close the invoices → ingredients seam (ingredients now exists)
-- ============================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sii_ingredient_fk'
  ) then
    alter table public.supplier_invoice_items
      add constraint sii_ingredient_fk foreign key (ingredient_id)
      references public.ingredients(id) on delete set null;
  end if;
end $$;

-- ============================================
-- RLS — all member full access + admin; no public read (private financials).
-- ============================================
alter table public.ingredients enable row level security;
alter table public.recipe_items enable row level security;
alter table public.labor_cost enable row level security;
alter table public.ingredient_cost_history enable row level security;

create policy "ingredients tenant access" on public.ingredients
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
create policy "recipe_items tenant access" on public.recipe_items
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
create policy "labor_cost tenant access" on public.labor_cost
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
create policy "ingredient_cost_history tenant access" on public.ingredient_cost_history
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

create policy "ingredients admin access" on public.ingredients
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "recipe_items admin access" on public.recipe_items
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "labor_cost admin access" on public.labor_cost
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "ingredient_cost_history admin access" on public.ingredient_cost_history
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- ============================================
-- Realtime (idempotent guard) — live inventory + P&L UI.
-- ============================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ingredients'
  ) then
    alter publication supabase_realtime add table public.ingredients;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'labor_cost'
  ) then
    alter publication supabase_realtime add table public.labor_cost;
  end if;
end $$;
