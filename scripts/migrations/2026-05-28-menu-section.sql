-- ============================================
-- 2026-05-28: Menu section (categories + items)
-- ============================================
-- Per-tenant menu. Categories are flat (no sub-categories by user decision).
-- Items have no photos by user decision. Allergens + tags are arrays so the
-- search bar can filter by allergene / tag without joins.

create table if not exists public.menu_categories (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_menu_categories_tenant on public.menu_categories(tenant_id, sort_order);

create table if not exists public.menu_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  name text not null,
  description text not null default '',
  price numeric(10,2),
  currency text not null default 'EUR',
  allergens text[] not null default '{}',
  tags text[] not null default '{}',
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_menu_items_tenant on public.menu_items(tenant_id);
create index if not exists idx_menu_items_category on public.menu_items(category_id);
create index if not exists idx_menu_items_search on public.menu_items
  using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'')));

-- ============================================
-- RLS
-- ============================================
alter table public.menu_categories enable row level security;
alter table public.menu_items enable row level security;

-- Tenant members can read/write their own tenant's menu.
create policy "menu_categories tenant access" on public.menu_categories
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

create policy "menu_items tenant access" on public.menu_items
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

-- Platform admins can do everything.
create policy "menu_categories admin access" on public.menu_categories
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

create policy "menu_items admin access" on public.menu_items
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

-- Public read for the hosted menu page /m/<slug>. Only items+categories of
-- tenants with status in (trial,active) are readable; available=false items
-- still readable (the public page hides them client-side so they can be
-- toggled live without re-publishing).
create policy "menu_categories public read" on public.menu_categories
  for select to anon using (
    exists (
      select 1 from public.tenants t
      where t.id = menu_categories.tenant_id
        and t.status in ('trial','active')
    )
  );

create policy "menu_items public read" on public.menu_items
  for select to anon using (
    exists (
      select 1 from public.tenants t
      where t.id = menu_items.tenant_id
        and t.status in ('trial','active')
    )
  );
