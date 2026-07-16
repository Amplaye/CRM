-- 2026-06-08: Add `tenants` to the realtime publication.
--
-- Why: the admin per-tenant feature toggle (Funzionalità → Gestionale,
-- settings.features.management_enabled) writes to tenants.settings, but the
-- tenant's open CRM session reads its flags from TenantContext, which cached
-- the tenant row in sessionStorage and only refreshed on a full reload or a
-- Settings-page save. So flipping the flag from the admin panel did NOT show
-- the Magazzino/Food Cost/P&L sidebar items live — the owner had to hard-reload.
--
-- With `tenants` in the publication, TenantContext subscribes to its own
-- tenant row and applies settings changes instantly (same pattern already used
-- for tenant_members, reservations, conversations, menu_* ...).
--
-- REPLICA IDENTITY: default (primary key) is enough — the UPDATE payload carries
-- the full NEW row, which is all we read (the fresh settings). No FULL needed.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tenants'
  ) then
    alter publication supabase_realtime add table public.tenants;
  end if;
end $$;
