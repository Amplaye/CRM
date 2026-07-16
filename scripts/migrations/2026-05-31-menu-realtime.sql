-- ============================================
-- 2026-05-31: Add menu tables to realtime publication
-- ============================================
-- The menu page subscribes to postgres_changes on menu_categories /
-- menu_items, but the 2026-05-28 migration never added these tables to the
-- supabase_realtime publication. Result: creating a category inserted the row
-- in the DB but the UI never refreshed (it relied on the realtime event).
-- These statements are idempotent-safe via the DO block guards.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'menu_categories'
  ) then
    alter publication supabase_realtime add table public.menu_categories;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'menu_items'
  ) then
    alter publication supabase_realtime add table public.menu_items;
  end if;
end $$;
