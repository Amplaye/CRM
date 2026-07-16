-- Fix slow load on /settings?tab=staff
--
-- Two issues addressed:
--   1) The policy "Tenant members can read each other profiles" on public.users
--      runs a self-join on tenant_members per row, with raw auth.uid() (not
--      wrapped in a subselect), so Postgres re-evaluates it for every row in
--      the result set. With realtime + a small team this is already noticeable.
--   2) Add an explicit (user_id, tenant_id) composite index to back the
--      self-join inside the policy efficiently.

-- Helper: returns true if `target_user_id` shares any tenant with the current
-- auth.uid(). SECURITY DEFINER + STABLE lets Postgres call it once per row
-- with a cached plan, instead of re-planning the EXISTS subquery each time.
create or replace function private.shares_tenant_with(target_user_id uuid)
returns boolean as $$
  select exists (
    select 1
    from public.tenant_members me
    join public.tenant_members other
      on other.tenant_id = me.tenant_id
    where me.user_id = (select auth.uid())
      and other.user_id = target_user_id
  );
$$ language sql security definer stable set search_path = public, pg_temp;

grant execute on function private.shares_tenant_with(uuid) to authenticated;

-- Replace the slow policy. Wrap auth.uid() in (select ...) too on the
-- "own profile" policy so it's evaluated once per query, not per row.
drop policy if exists "Tenant members can read each other profiles" on public.users;
drop policy if exists "Users can read own profile" on public.users;

create policy "Users can read own profile"
  on public.users
  for select
  using (
    id = (select auth.uid())
    or private.is_platform_admin()
  );

create policy "Tenant members can read each other profiles"
  on public.users
  for select
  using (
    private.shares_tenant_with(id)
  );

-- Composite index that supports both the policy's self-join and StaffTab's
-- per-tenant query. The two single-column indexes already exist, but a
-- (tenant_id, user_id) index is what the join actually wants.
create index if not exists idx_tenant_members_tenant_user
  on public.tenant_members(tenant_id, user_id);
