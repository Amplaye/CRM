-- Security: per-login audit table populated client-side after each successful
-- sign-in. We don't use auth.audit_log_entries because Supabase doesn't log
-- auth events to that table on this plan (it stays empty).
--
-- Flow:
--   1. /login (and /register) calls POST /api/auth/log-login after a
--      successful signInWithPassword.
--   2. That API route reads the session, captures req IP + user-agent,
--      inserts into public.login_events.
--   3. /admin/security reads recent rows via the SECURITY DEFINER RPC
--      admin_get_login_events, which is gated by private.is_platform_admin.
--
-- Geo enrichment (country/city from IP) is layered on top in the API route
-- using ipapi.co with the public.ip_geo_cache TTL'd table.

create table if not exists public.login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  ip_address text,
  user_agent text,
  provider text,
  created_at timestamptz not null default now()
);

create index if not exists login_events_created_at_idx on public.login_events (created_at desc);
create index if not exists login_events_user_id_idx on public.login_events (user_id);

alter table public.login_events enable row level security;

-- Only platform admins read. Inserts happen through the service role from
-- the /api/auth/log-login route (RLS bypassed there) so no insert policy
-- is needed for end users.
drop policy if exists "Platform admins read login events" on public.login_events;
create policy "Platform admins read login events" on public.login_events
  for select using (private.is_platform_admin());

-- Aggregated/joined RPC for the admin dashboard. SECURITY DEFINER so we can
-- attach tenant info even when the calling user can't read tenant_members
-- for other tenants. The is_platform_admin() check inside the body is what
-- enforces access.
create or replace function public.admin_get_login_events(p_days int default 30)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  actor_id uuid,
  actor_email text,
  ip_address text,
  user_agent text,
  tenant_id uuid,
  tenant_name text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    le.id,
    le.created_at,
    'login'::text as action,
    le.user_id as actor_id,
    le.email as actor_email,
    le.ip_address,
    le.user_agent,
    tm.tenant_id,
    t.name as tenant_name
  from public.login_events le
  left join lateral (
    select tm.tenant_id
    from public.tenant_members tm
    where tm.user_id = le.user_id
    order by tm.created_at asc nulls last
    limit 1
  ) tm on true
  left join public.tenants t on t.id = tm.tenant_id
  where le.created_at >= now() - (p_days || ' days')::interval
    and private.is_platform_admin()
  order by le.created_at desc;
$$;

revoke all on function public.admin_get_login_events(int) from public, anon;
grant execute on function public.admin_get_login_events(int) to authenticated;

-- IP geo cache so we don't hammer ipapi.co. TTL enforced application-side
-- (we treat rows older than 30 days as stale).
create table if not exists public.ip_geo_cache (
  ip text primary key,
  country text,
  country_code text,
  city text,
  region text,
  org text,
  fetched_at timestamptz not null default now()
);

alter table public.ip_geo_cache enable row level security;

-- Reads/writes happen exclusively via service role, no end-user access needed,
-- but we leave a platform-admin read policy for ad-hoc debugging.
drop policy if exists "Platform admins read ip cache" on public.ip_geo_cache;
create policy "Platform admins read ip cache" on public.ip_geo_cache
  for select using (private.is_platform_admin());

-- Clean up the older insert/update policies from the first iteration of this
-- migration, since writes now go through service role only.
drop policy if exists "Platform admins write ip cache" on public.ip_geo_cache;
drop policy if exists "Platform admins update ip cache" on public.ip_geo_cache;
