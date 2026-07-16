-- ============================================
-- 2026-06-01: Menu collections (Raccolte)
-- ============================================
-- A "collection" is a curated grouping that references EXISTING dishes via a
-- many-to-many junction. A dish stays in its single home category (menu_items
-- .category_id is untouched) but can also appear in one or more collections —
-- e.g. Tiramisù stays in "Dolci" AND shows under "Consigliati" / "Menu del
-- giorno". This is purely additive: nothing about menu_categories / menu_items
-- changes.
--
-- "Classic" collections are normal rows whose `kind` is one of a small known
-- set (drives the icon, the localized display name, and the bot synonyms).
-- Custom collections have kind = null and a user-given name shown verbatim.

create table if not exists public.menu_collections (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  -- null = custom/free-named; otherwise a known classic.
  kind text check (kind is null or kind in ('consigliati','menu_del_giorno','specialita','novita')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_menu_collections_tenant on public.menu_collections(tenant_id, sort_order);

-- Junction. tenant_id is denormalized on purpose: it lets every RLS policy use
-- the exact same private.is_tenant_member(tenant_id) predicate as the other
-- menu tables (no join), and lets the public-read policy + realtime filter work
-- uniformly. ON DELETE CASCADE on BOTH fks means deleting a collection or a
-- dish cleans up its links automatically (dishes/collections themselves are
-- never touched by the other's deletion).
create table if not exists public.menu_collection_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  collection_id uuid not null references public.menu_collections(id) on delete cascade,
  item_id uuid not null references public.menu_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint menu_collection_items_unique unique (collection_id, item_id)
);

create index if not exists idx_menu_collection_items_collection on public.menu_collection_items(collection_id);
create index if not exists idx_menu_collection_items_item on public.menu_collection_items(item_id);
create index if not exists idx_menu_collection_items_tenant on public.menu_collection_items(tenant_id);

-- ============================================
-- RLS (mirrors 2026-05-28-menu-section.sql verbatim)
-- ============================================
alter table public.menu_collections enable row level security;
alter table public.menu_collection_items enable row level security;

create policy "menu_collections tenant access" on public.menu_collections
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

create policy "menu_collection_items tenant access" on public.menu_collection_items
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

create policy "menu_collections admin access" on public.menu_collections
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

create policy "menu_collection_items admin access" on public.menu_collection_items
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());

-- Public read for the hosted menu page /m/<slug>, same predicate as the rest of
-- the menu (only trial/active tenants).
create policy "menu_collections public read" on public.menu_collections
  for select to anon using (
    exists (
      select 1 from public.tenants t
      where t.id = menu_collections.tenant_id
        and t.status in ('trial','active')
    )
  );

create policy "menu_collection_items public read" on public.menu_collection_items
  for select to anon using (
    exists (
      select 1 from public.tenants t
      where t.id = menu_collection_items.tenant_id
        and t.status in ('trial','active')
    )
  );

-- ============================================
-- Realtime (idempotent guard, mirrors 2026-05-31-menu-realtime.sql)
-- ============================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'menu_collections'
  ) then
    alter publication supabase_realtime add table public.menu_collections;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'menu_collection_items'
  ) then
    alter publication supabase_realtime add table public.menu_collection_items;
  end if;
end $$;
