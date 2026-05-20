-- Security: surface auth.audit_log_entries to platform admins so they can
-- monitor daily logins across all tenants and spot unfamiliar access.
--
-- auth.audit_log_entries is not exposed through PostgREST. We wrap it in a
-- SECURITY DEFINER function gated by private.is_platform_admin() so the
-- service role isn't required at request time.
--
-- The payload column is jsonb-shaped (Supabase Auth writes JSON). For
-- login-style events the shape is roughly:
--   { "action": "login" | "token_refreshed" | ..., "actor_id": "<uuid>",
--     "actor_username": "<email>", "traits": { "provider": "email", ... } }
-- IP and user agent are stored on dedicated columns (ip_address) and inside
-- payload.traits when available. We extract what we can; geo enrichment
-- happens application-side from the IP.

-- Note: function lives in public schema because PostgREST only exposes
-- public + graphql_public on this project. The platform_admin check inside
-- the body is what enforces access.
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
set search_path = public, auth, pg_temp
as $$
  with raw as (
    select
      a.id,
      a.created_at,
      coalesce(a.payload->>'action', '') as action,
      nullif(a.payload->>'actor_id', '')::uuid as actor_id,
      a.payload->>'actor_username' as actor_email,
      coalesce(nullif(a.ip_address::text, ''), a.payload->>'ip_address') as ip_address,
      coalesce(a.payload->'traits'->>'user_agent', a.payload->>'user_agent') as user_agent
    from auth.audit_log_entries a
    where a.created_at >= now() - (p_days || ' days')::interval
      and coalesce(a.payload->>'action', '') in ('login', 'user_signedup', 'token_refreshed')
  )
  select
    r.id,
    r.created_at,
    r.action,
    r.actor_id,
    r.actor_email,
    r.ip_address,
    r.user_agent,
    tm.tenant_id,
    t.name as tenant_name
  from raw r
  left join lateral (
    select tm.tenant_id
    from public.tenant_members tm
    where tm.user_id = r.actor_id
    order by tm.joined_at asc nulls last
    limit 1
  ) tm on true
  left join public.tenants t on t.id = tm.tenant_id
  where private.is_platform_admin()
  order by r.created_at desc;
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

drop policy if exists "Platform admins read ip cache" on public.ip_geo_cache;
create policy "Platform admins read ip cache" on public.ip_geo_cache
  for select using (private.is_platform_admin());

drop policy if exists "Platform admins write ip cache" on public.ip_geo_cache;
create policy "Platform admins write ip cache" on public.ip_geo_cache
  for insert with check (private.is_platform_admin());

drop policy if exists "Platform admins update ip cache" on public.ip_geo_cache;
create policy "Platform admins update ip cache" on public.ip_geo_cache
  for update using (private.is_platform_admin());
