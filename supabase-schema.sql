-- ============================================
-- BaliFlow CRM - Supabase Database Schema
-- ============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================
-- 1. USERS
-- ============================================
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  name text not null default '',
  global_role text not null default 'user' check (global_role in ('platform_admin', 'user')),
  created_at timestamptz not null default now()
);

-- ============================================
-- 2. TENANTS
-- ============================================
create table public.tenants (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  -- Public URL-safe identifier for hosted pages like /m/<slug> (menu).
  -- Unique, kebab-case; backfilled from name for legacy rows.
  slug text not null unique,
  business_type text not null default 'restaurant' check (business_type in ('restaurant', 'ecommerce', 'services', 'other')),
  -- Tenant lifecycle (SaaS gate). Only 'trial'/'active' receive AI traffic;
  -- 'pending' (registered, not yet provisioned), 'suspended' (turned off) and
  -- 'archived' (soft-removed via offboarding, hidden, purged after a grace period)
  -- do not. Single source of truth: src/lib/tenants/status.ts. Gate: src/app/api/webhooks/route.ts.
  status text not null default 'active' check (status in ('pending', 'trial', 'active', 'suspended', 'archived')),
  -- Set by the offboarding flow (src/lib/tenants/delete-tenant.ts): when archived
  -- and purge_after has passed, the daily cron permanently deletes the tenant.
  archived_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  settings jsonb not null default '{"timezone": "Europe/Rome", "currency": "EUR", "ai_enabled_channels": []}'::jsonb
);

-- ============================================
-- 3. TENANT MEMBERS
-- ============================================
create table public.tenant_members (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'readonly' check (role in ('owner', 'admin', 'manager', 'host', 'marketing', 'readonly')),
  created_at timestamptz not null default now(),
  unique(tenant_id, user_id)
);

-- ============================================
-- 4. GUESTS
-- ============================================
create table public.guests (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  phone text not null default '',
  email text,
  visit_count integer not null default 0,
  no_show_count integer not null default 0,
  cancellation_count integer not null default 0,
  tags text[] not null default '{}',
  notes text not null default '',
  dietary_notes text,
  accessibility_notes text,
  family_notes text,
  estimated_spend numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 5. RESERVATIONS
-- ============================================
create table public.reservations (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  date text not null,
  time text not null,
  party_size integer not null default 2,
  status text not null default 'pending_confirmation' check (status in ('inquiry', 'pending_confirmation', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show', 'waitlist_offered', 'escalated')),
  source text not null default 'staff' check (source in ('ai_chat', 'ai_voice', 'staff', 'web', 'walk_in')),
  cancellation_source text check (cancellation_source in ('reminder_24h', 'reminder_4h', 'chat_spontaneous', 'voice_spontaneous', 'auto_noshow', 'staff', 'web')),
  noshow_warning_responded boolean not null default false,
  created_by_type text not null default 'staff' check (created_by_type in ('ai', 'staff', 'guest')),
  notes text not null default '',
  allergies text[],
  tags text[],
  linked_conversation_id uuid references public.conversations(id) on delete set null,
  -- Generated channel for target-architecture compatibility: maps the
  -- existing 'source' enum onto the channel taxonomy (whatsapp/voice/web).
  channel text generated always as (
    case
      when source = 'ai_chat' then 'whatsapp'
      when source = 'ai_voice' then 'voice'
      else 'web'
    end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 6. RESERVATION EVENTS (audit trail)
-- ============================================
create table public.reservation_events (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  action text not null check (action in ('created', 'status_changed', 'time_changed', 'party_size_changed', 'cancelled', 'note_added')),
  previous_status text,
  new_status text,
  details text,
  changed_by_user_id text not null default 'system',
  created_at timestamptz not null default now()
);

-- ============================================
-- 7. WAITLIST ENTRIES
-- ============================================
create table public.waitlist_entries (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  date text not null,
  target_time text not null,
  party_size integer not null default 2,
  acceptable_time_range jsonb not null default '{"start": "18:00", "end": "22:00"}'::jsonb,
  contact_preference text not null default 'whatsapp' check (contact_preference in ('whatsapp', 'sms', 'call')),
  priority_score integer not null default 50,
  status text not null default 'waiting' check (status in ('waiting', 'match_found', 'contacted', 'accepted', 'declined', 'expired', 'converted_to_booking')),
  matched_reservation_id uuid references public.reservations(id),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 8. CONVERSATIONS
-- ============================================
create table public.conversations (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'voice')),
  intent text not null default '',
  extracted_entities jsonb,
  linked_reservation_id uuid references public.reservations(id),
  status text not null default 'active' check (status in ('active', 'resolved', 'escalated', 'abandoned')),
  escalation_flag boolean not null default false,
  sentiment text not null default 'neutral' check (sentiment in ('positive', 'neutral', 'negative')),
  summary text not null default '',
  transcript jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 9. INCIDENTS
-- ============================================
create table public.incidents (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type text not null check (type in ('complaint', 'ai_error', 'conflict', 'health_safety')),
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved')),
  severity text not null default 'low' check (severity in ('low', 'medium', 'critical')),
  owner_id text,
  linked_reservation_id uuid references public.reservations(id),
  linked_conversation_id uuid references public.conversations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 10. KNOWLEDGE ARTICLES
-- ============================================
create table public.knowledge_articles (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  content text not null default '',
  category text not null default 'general' check (category in ('policies', 'menu', 'troubleshooting', 'general')),
  risk_tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 1,
  author_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- 11. MENU (categories + items)
-- ============================================
-- Per-tenant menu. Categories are flat (no sub-categories). Items can carry an
-- optional photo (image_url → public "menu-images" Storage bucket, path
-- <tenant_id>/<item_id>.webp). Allergens + tags are arrays so the search bar can
-- filter by allergene / tag without joins. Public read for /m/<slug> hosted menu page.
create table public.menu_categories (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_items (
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
  image_url text,
  sort_order integer not null default 0,
  -- POS write-back link: the external product/variant id of the till product this
  -- dish maps to (populated by the sync's name-match step). With it, a price
  -- changed in the CRM can be pushed back to the till for THIS exact product,
  -- instead of re-guessing by name. Null until a sync matches the dish.
  pos_external_product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Storage: a public "menu-images" bucket holds optional dish photos. The owner
-- uploads from the CRM menu editor; the public /m/<slug> page reads them. Policies:
--   menu_images_public_read   (select, public)      — anyone can view a dish photo
--   menu_images_auth_insert/update/delete (authenticated) — only signed-in owners write
-- (Bucket + policies are created out-of-band via the Storage + Management API,
--  not by this schema file — documented here for reference.)
--
-- Storage: a public "branding" bucket holds each tenant's custom CRM logo
-- (settings.branding.logo_url, path <tenant_id>/logo.webp). The owner uploads
-- from Settings → General; the Sidebar renders it top-left (replacing the
-- BaliFlow mark) and bottom-left (replacing the initials avatar). Policies:
--   branding_public_read   (select, public)        — anyone can view a logo
--   branding_auth_insert/update/delete (authenticated) — only signed-in owners write
-- (2MB cap, png/jpeg/webp only. Created out-of-band like menu-images above.)

-- ============================================
-- 12. AUDIT EVENTS
-- ============================================
create table public.audit_events (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action text not null,
  entity_id text not null,
  idempotency_key text,
  source text not null default 'system' check (source in ('ai_agent', 'system', 'staff')),
  agent_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_tenant_members_user on public.tenant_members(user_id);
create index idx_tenant_members_tenant on public.tenant_members(tenant_id);
-- Composite index that supports the self-join inside the users RLS policy
-- and StaffTab's per-tenant query.
create index if not exists idx_tenant_members_tenant_user on public.tenant_members(tenant_id, user_id);
create index idx_guests_tenant on public.guests(tenant_id);
create index idx_reservations_tenant on public.reservations(tenant_id);
create index idx_reservations_date on public.reservations(tenant_id, date);
create index idx_reservations_guest on public.reservations(guest_id);
create index idx_reservation_events_reservation on public.reservation_events(reservation_id);
create index idx_waitlist_tenant on public.waitlist_entries(tenant_id);
create index idx_conversations_tenant on public.conversations(tenant_id);
create index idx_incidents_tenant on public.incidents(tenant_id);
create index idx_knowledge_tenant on public.knowledge_articles(tenant_id);
create index idx_audit_events_tenant on public.audit_events(tenant_id);
create index idx_audit_events_idempotency on public.audit_events(idempotency_key);

-- Hot-path indexes for the AI ingestion + admin views (Tier 4.10).
create index if not exists idx_conversations_tenant_guest_channel_status
  on public.conversations(tenant_id, guest_id, channel, status);
create index if not exists idx_audit_events_tenant_action_created
  on public.audit_events(tenant_id, action, created_at desc);
create index if not exists idx_system_logs_tenant_severity_created
  on public.system_logs(tenant_id, severity, created_at desc);

-- ============================================
-- Rate limiting (Tier 1.8): opt-in via RATE_LIMIT_ENABLED=1.
-- Each `consume_rate_limit(key, window_secs, max)` call atomically
-- increments the per-key/per-window counter and returns whether the
-- caller is still allowed.
-- ============================================
create table if not exists public.rate_limit_buckets (
  bucket_key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket_key, window_start)
);
create index if not exists idx_rate_limit_buckets_window on public.rate_limit_buckets(window_start);
alter table public.rate_limit_buckets enable row level security;

create or replace function public.consume_rate_limit(
  p_key text,
  p_window_secs int,
  p_max int
)
returns table(allowed bool, current_count int, reset_at timestamptz)
language plpgsql security definer
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  v_window_start := to_timestamp((extract(epoch from now())::bigint / p_window_secs) * p_window_secs);

  insert into public.rate_limit_buckets (bucket_key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = rate_limit_buckets.count + 1
  returning count into v_count;

  return query select (v_count <= p_max), v_count, (v_window_start + (p_window_secs || ' seconds')::interval);
end;
$$;
revoke execute on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
alter table public.users enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.guests enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_events enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.conversations enable row level security;
alter table public.incidents enable row level security;
alter table public.knowledge_articles enable row level security;
alter table public.audit_events enable row level security;

-- RLS helper functions live in `private` schema so they are not exposed via
-- /rest/v1/rpc (Supabase Security Advisor). EXECUTE remains granted to
-- authenticated/anon so RLS policies can still evaluate them.
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- Helper: check if user is member of a tenant
create or replace function private.is_tenant_member(p_tenant_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = auth.uid()
  );
$$ language sql security definer stable set search_path = public, pg_temp;

-- Helper: check if user is platform admin
create or replace function private.is_platform_admin()
returns boolean as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and global_role = 'platform_admin'
  );
$$ language sql security definer stable set search_path = public, pg_temp;

-- Helper: get user's role in a tenant
create or replace function private.get_tenant_role(p_tenant_id uuid)
returns text as $$
  select role from public.tenant_members
  where tenant_id = p_tenant_id and user_id = auth.uid()
  limit 1;
$$ language sql security definer stable set search_path = public, pg_temp;

-- Helper used by the "read each other profiles" policy. SECURITY DEFINER +
-- STABLE means Postgres can cache the plan and call it once per row without
-- re-planning the EXISTS subquery — important for /settings?tab=staff which
-- joins users via tenant_members.
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

-- USERS policies. auth.uid() is wrapped in (select ...) so it's evaluated
-- once per query, not once per row.
create policy "Users can read own profile" on public.users for select using (id = (select auth.uid()) or private.is_platform_admin());
create policy "Tenant members can read each other profiles" on public.users for select using (
  private.shares_tenant_with(id)
);
create policy "Users can update own profile" on public.users for update using (id = auth.uid()) with check (id = auth.uid());
create policy "Users can insert own profile" on public.users for insert with check (id = auth.uid());

-- C1 hardening: a self-row UPDATE/INSERT must not be able to grant global_role.
-- The RLS WITH CHECK above only verifies the row identity (id), not which columns
-- changed, so we lock global_role at two extra layers:
--   1. revoke the column privilege from client roles (PostgREST honours this);
--   2. a SECURITY DEFINER trigger that rejects any global_role change unless the
--      caller is service_role / postgres (defense in depth if a grant returns).
-- handle_new_user() (SECURITY DEFINER, owned by postgres) inserts with the default
-- global_role 'user', so the normal signup path is unaffected.
revoke update (global_role) on public.users from authenticated, anon;
revoke insert (global_role) on public.users from authenticated, anon;

create or replace function public.prevent_global_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.global_role is distinct from old.global_role then
    if current_setting('role', true) <> 'service_role' and current_user <> 'postgres' then
      raise exception 'global_role can only be changed by service_role';
    end if;
  end if;
  if tg_op = 'INSERT' and new.global_role is distinct from 'user' then
    if current_setting('role', true) <> 'service_role' and current_user <> 'postgres' then
      raise exception 'global_role can only be set by service_role';
    end if;
  end if;
  return new;
end;$$;

drop trigger if exists trg_prevent_global_role_change on public.users;
create trigger trg_prevent_global_role_change
  before insert or update on public.users
  for each row execute function public.prevent_global_role_change();

-- TENANTS policies
create policy "Tenant members can read tenants" on public.tenants for select using (private.is_tenant_member(id) or private.is_platform_admin());
create policy "Owners/managers can update tenant" on public.tenants for update using (private.get_tenant_role(id) in ('owner', 'manager') or private.is_platform_admin());
create policy "Platform admins can create tenants" on public.tenants for insert with check (private.is_platform_admin());
create policy "Platform admins can delete tenants" on public.tenants for delete using (private.is_platform_admin());

-- TENANT MEMBERS policies
create policy "Members can read own memberships" on public.tenant_members for select using (user_id = auth.uid() or private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "Owners/managers can manage members" on public.tenant_members for insert with check (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());
create policy "Owners/managers can update members" on public.tenant_members for update using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());
create policy "Owners/managers can remove members" on public.tenant_members for delete using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());

-- GUESTS policies
create policy "Tenant members can read guests" on public.guests for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "Staff can manage guests" on public.guests for insert with check (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());
create policy "Staff can update guests" on public.guests for update using (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());
create policy "Managers can delete guests" on public.guests for delete using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());

-- RESERVATIONS policies
create policy "Tenant members can read reservations" on public.reservations for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "Staff can create reservations" on public.reservations for insert with check (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());
create policy "Staff can update reservations" on public.reservations for update using (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());
create policy "Managers can delete reservations" on public.reservations for delete using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());

-- RESERVATION EVENTS policies (read-only for clients, server writes via service_role)
create policy "Tenant members can read events" on public.reservation_events for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- WAITLIST policies
create policy "Tenant members can read waitlist" on public.waitlist_entries for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "Staff can manage waitlist" on public.waitlist_entries for insert with check (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());
create policy "Staff can update waitlist" on public.waitlist_entries for update using (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());
create policy "Staff can delete waitlist" on public.waitlist_entries for delete using (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());

-- CONVERSATIONS policies
create policy "Tenant members can read conversations" on public.conversations for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "Staff can manage conversations" on public.conversations for insert with check (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());
create policy "Staff can update conversations" on public.conversations for update using (private.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or private.is_platform_admin());

-- INCIDENTS policies
create policy "Tenant members can read incidents" on public.incidents for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "Managers can manage incidents" on public.incidents for insert with check (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());
create policy "Managers can update incidents" on public.incidents for update using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());

-- KNOWLEDGE ARTICLES policies
create policy "Tenant members can read articles" on public.knowledge_articles for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "Managers can manage articles" on public.knowledge_articles for insert with check (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());
create policy "Managers can update articles" on public.knowledge_articles for update using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());

-- AUDIT EVENTS policies (read-only for clients)
create policy "Tenant members can read audit events" on public.audit_events for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- ============================================
-- FUNCTION: Auto-create user profile on signup
-- ============================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger function: not callable via /rest/v1/rpc. Hide from anon/authenticated.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ============================================
-- FUNCTION: Auto-update updated_at timestamp
-- ============================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_guests_updated_at before update on public.guests for each row execute function public.update_updated_at();
create trigger update_reservations_updated_at before update on public.reservations for each row execute function public.update_updated_at();
create trigger update_waitlist_updated_at before update on public.waitlist_entries for each row execute function public.update_updated_at();
create trigger update_conversations_updated_at before update on public.conversations for each row execute function public.update_updated_at();
create trigger update_incidents_updated_at before update on public.incidents for each row execute function public.update_updated_at();
create trigger update_knowledge_updated_at before update on public.knowledge_articles for each row execute function public.update_updated_at();
create trigger update_automations_updated_at before update on public.automation_rules for each row execute function public.update_updated_at();

-- ============================================
-- COMPOSITE INDEXES (added 2026-04-25)
-- Match the actual query patterns in src/ + n8n bots:
--   - feed lookups (tenant + created_at DESC)
--   - filtered list queries (tenant + status + date)
--   - bot guest lookup (tenant + phone)
--   - KB published filter (tenant + status)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_status_date
  ON public.reservations (tenant_id, status, date);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant_created
  ON public.reservations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_entries_tenant_status_date
  ON public.waitlist_entries (tenant_id, status, date);
CREATE INDEX IF NOT EXISTS idx_waitlist_entries_tenant_created
  ON public.waitlist_entries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_action_created
  ON public.audit_events (tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guests_tenant_phone
  ON public.guests (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_tenant_status
  ON public.knowledge_articles (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_system_logs_tenant_status_created
  ON public.system_logs (tenant_id, status, created_at DESC);

-- ============================================
-- TABLES ADDED LIVE 2026-04 → 2026-05 (synced 2026-05-12)
-- These tables exist in the live DB but were missing from this DDL.
-- All RLS-enabled; policies live in DB (see Supabase Security Advisor).
-- ============================================

-- 13. BOT SESSIONS — chatbot dialog state machine (Picnic state machine v2)
create table if not exists public.bot_sessions (
  phone text primary key,
  session_data jsonb default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  lock_until timestamptz
);
alter table public.bot_sessions enable row level security;
create index if not exists bot_sessions_updated_at_idx
  on public.bot_sessions (updated_at);

-- 14. CONVERSATION AUDITS — nightly LLM-graded audit (outcome/quality/divergence)
create table if not exists public.conversation_audits (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  outcome text not null check (outcome in ('booked','cancelled','modified','info_only','abandoned','escalated','error','unclear')),
  quality text not null check (quality in ('good','minor_issue','major_issue')),
  issues jsonb default '[]'::jsonb,
  intended_booking jsonb,
  actual_booking jsonb,
  divergence boolean default false,
  language text,
  summary text,
  model text,
  cost_usd numeric,
  created_at timestamptz default now()
);
alter table public.conversation_audits enable row level security;
create index if not exists idx_conversation_audits_tenant_created
  on public.conversation_audits (tenant_id, created_at desc);
create index if not exists idx_conversation_audits_quality
  on public.conversation_audits (tenant_id, quality) where quality <> 'good';

-- 15. SYSTEM LOGS — operational observability (errors, low-severity rejections)
create table if not exists public.system_logs (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  category text not null check (category in ('booking_error','webhook_failure','message_failure','api_error','ai_error','system','n8n_error','health_check','silent_warning')),
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  title text not null,
  description text,
  metadata jsonb default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  created_at timestamptz default now(),
  resolved_at timestamptz,
  alerted_at timestamptz
);
alter table public.system_logs enable row level security;
create index if not exists idx_system_logs_created
  on public.system_logs (created_at desc);
create index if not exists idx_system_logs_status
  on public.system_logs (status);
create index if not exists idx_system_logs_tenant
  on public.system_logs (tenant_id);
create index if not exists idx_system_logs_alert_pending
  on public.system_logs (created_at desc)
  where alerted_at is null and status = 'open' and severity = 'high';

-- 16. PENDING RECAPS — recap card awaiting client CONFIRMO
create table if not exists public.pending_recaps (
  phone text primary key,
  recap text not null,
  created_at timestamptz default now(),
  booking_date text,
  booking_time text,
  booking_agent text,
  client_name text,
  appointment_id text
);
alter table public.pending_recaps enable row level security;

-- 17. RESTAURANT TABLES — physical tables (used by table allocator + floor plan UI)
create table if not exists public.restaurant_tables (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  seats integer not null default 4,
  status text not null default 'active' check (status in ('active','inactive')),
  position_x integer not null default 0,
  position_y integer not null default 0,
  shape text not null default 'square' check (shape in ('round','square','rectangle')),
  zone text not null default 'Principal',
  created_at timestamptz not null default now()
);
alter table public.restaurant_tables enable row level security;
create index if not exists idx_restaurant_tables_tenant
  on public.restaurant_tables (tenant_id);

-- 18. RESERVATION TABLES — junction reservation ↔ restaurant_table
create table if not exists public.reservation_tables (
  id uuid default uuid_generate_v4() primary key,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(reservation_id, table_id)
);
alter table public.reservation_tables enable row level security;
create index if not exists idx_reservation_tables_res
  on public.reservation_tables (reservation_id);
create index if not exists idx_reservation_tables_table
  on public.reservation_tables (table_id);

-- 19. WEBHOOK EVENTS — idempotency table for /api/webhooks gateway
-- Note: tenant_id is text (legacy: stores the apiKey/secret as identifier)
create table if not exists public.webhook_events (
  id uuid default uuid_generate_v4() primary key,
  tenant_id text not null,
  idempotency_key text not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'processing' check (status in ('processing','success','failed')),
  error_log text,
  handoff_to_human boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.webhook_events enable row level security;

-- 20. CLIENT NOTES — staff/admin freeform tenant notes
create table if not exists public.client_notes (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content text not null,
  author text not null default 'admin',
  created_at timestamptz default now()
);
alter table public.client_notes enable row level security;
create index if not exists idx_client_notes_tenant
  on public.client_notes (tenant_id, created_at desc);

-- 21. BALI CONVERSATIONS — legacy BaliFlow agency chat ledger (pre-multitenant)
create table if not exists public.bali_conversations (
  id uuid default gen_random_uuid() primary key,
  guest_phone text not null unique,
  guest_name text,
  human_takeover boolean not null default false,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  last_message_direction text,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bali_conversations enable row level security;
create index if not exists idx_bali_conversations_last_at
  on public.bali_conversations (last_message_at desc);

-- 22. BALI MESSAGES — legacy BaliFlow message turns
create table if not exists public.bali_messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid not null references public.bali_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  sender text not null check (sender in ('client','bot','human')),
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.bali_messages enable row level security;
create index if not exists idx_bali_messages_conv_created
  on public.bali_messages (conversation_id, created_at);

-- ============================================
-- API KEY ROTATION (added 2026-05-12)
-- Replaces the cleartext "Bearer {tenant_uuid}" pattern. Routes hash the
-- bearer with sha256 and look it up in tenant_api_keys. Legacy callers
-- still work because we seed one row per tenant with key = tenant_id.
-- ============================================
create extension if not exists pgcrypto;

create table if not exists public.tenant_api_keys (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key_hash text not null unique,
  label text not null default '',
  scope text not null default 'webhooks' check (scope in ('webhooks','admin','ai_secret','readonly')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.tenant_api_keys enable row level security;
create index if not exists idx_tenant_api_keys_tenant on public.tenant_api_keys(tenant_id);
create index if not exists idx_tenant_api_keys_active on public.tenant_api_keys(key_hash) where revoked_at is null;

-- Legacy compat seed — sha256(tenant_id) so existing "Bearer {tenant_id}" callers keep working.
insert into public.tenant_api_keys (tenant_id, key_hash, label, scope)
select id, encode(digest(id::text, 'sha256'), 'hex'), 'legacy-bearer-tenant-id', 'webhooks'
from public.tenants
on conflict (key_hash) do nothing;

-- Helper for routes: lookup tenant_id by hashed api key.
create or replace function public.resolve_tenant_api_key(p_key_hash text)
returns uuid as $$
  select tenant_id from public.tenant_api_keys
  where key_hash = p_key_hash and revoked_at is null
  limit 1;
$$ language sql security definer stable;
revoke execute on function public.resolve_tenant_api_key(text) from public, anon, authenticated;

-- ============================================
-- QR LOGIN TOKENS — one-time tokens for staff phone login
-- ============================================
create table if not exists public.qr_login_tokens (
  id uuid default uuid_generate_v4() primary key,
  token text unique not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- user_id is null while the QR represents a pending staff invite. On first
  -- scan we create the Supabase user lazily and populate this column.
  user_id uuid references public.users(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  pending_name text,
  pending_role text
);

create index if not exists idx_qr_login_tokens_token on public.qr_login_tokens(token);
create index if not exists idx_qr_login_tokens_expires on public.qr_login_tokens(expires_at);
create index if not exists idx_qr_login_tokens_user on public.qr_login_tokens(user_id);

alter table public.qr_login_tokens enable row level security;

drop policy if exists "Owners/managers can read tenant qr tokens" on public.qr_login_tokens;
create policy "Owners/managers can read tenant qr tokens"
  on public.qr_login_tokens for select
  using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());

-- REALTIME: enable broadcasts for tenant_members so the staff list updates live in /settings
alter publication supabase_realtime add table public.tenant_members;
-- DELETE payloads must carry user_id (not just the PK) so the dashboard's
-- membership-guard filter `user_id=eq.<me>` actually matches and signs out
-- staff in real time when an Admin removes them.
alter table public.tenant_members replica identity full;

-- REALTIME: enable broadcasts for tenants so a tenant's open CRM session sees
-- settings changes live — specifically the admin per-tenant feature toggles
-- (settings.features.*, e.g. management_enabled → Gestionale sidebar items).
-- Default replica identity (PK) is enough: the UPDATE payload carries the full
-- NEW row, which is all TenantContext reads.
alter publication supabase_realtime add table public.tenants;

-- =====================================================================
-- SECURITY HARDENING (2026-05-29) — applied to the live DB via the
-- Management API and codified here. See SECURITY_REVIEW_2026-05-29.md.
-- =====================================================================

-- L5 — provider secrets must not be readable by ordinary tenant members.
-- tenants.settings (JSONB) is selectable by every member (see the "Tenant
-- members can read tenants" policy), and it used to embed live provider
-- secrets under settings.bot_config (meta_access_token, twilio_auth_token,
-- twilio_account_sid). Those now live in a dedicated `secrets` column whose
-- SELECT/UPDATE/INSERT privileges are revoked from the client roles — only
-- service_role (server-side / n8n) can read them. Postgres has no per-JSONB-key
-- RLS, so we enforce this with column-level GRANTs: the table-wide grants are
-- dropped and every column EXCEPT `secrets` is re-granted explicitly.
alter table public.tenants add column if not exists secrets jsonb not null default '{}'::jsonb;

revoke select, insert, update on public.tenants from authenticated;
revoke select, insert, update on public.tenants from anon;

grant select (id, name, business_type, created_at, settings, status, archived_at, purge_after, slug)
  on public.tenants to authenticated;
grant select (id, name, business_type, created_at, settings, status, archived_at, purge_after, slug)
  on public.tenants to anon;
grant update (name, business_type, settings, status, archived_at, purge_after, slug)
  on public.tenants to authenticated;
grant insert (id, name, business_type, settings, status, slug)
  on public.tenants to authenticated;
-- service_role keeps full access (default), so server reads of `secrets` work.
-- DONE: the n8n chatbot loaders now read tenants.secrets (merged into
-- bot_config) and the secret keys were stripped from settings.bot_config for
-- every tenant, so the member-readable copy is gone. Verified end-to-end with a
-- live WhatsApp send before stripping.

-- L6 — RLS-enabled tables with NO policy are intentional deny-all for the
-- anon/authenticated roles: bot_sessions, bot_messages, trello_synced_audits,
-- tenant_api_keys, rate_limit_buckets. They are backend-only and accessed
-- exclusively via service_role (which bypasses RLS). RLS-enabled + zero
-- policies = deny-all by default for client roles, which is the desired state.
-- Documented here so the repo reflects the live DB (these were "deferred").

-- ============================================
-- GESTIONALE (iammi-style controllo gestione) — mirror of
-- scripts/migrations/2026-06-08-pos-ingestion.sql + 2026-06-08-management-foodcost.sql
-- Canonical POS ingestion (pos_*), supplier invoices, and the food-cost /
-- inventory / P&L consumption layer (ingredients, recipes, labor, cost history).
-- ============================================

-- ============================================
-- 2026-06-08: POS ingestion (gestionale, part 1/2)
-- ============================================
-- Canonical, POS-agnostic ingestion layer. Everything downstream (dashboards,
-- food cost, P&L, assistant) reads ONLY pos_sales / pos_sale_items — never a
-- vendor format. Each till is an adapter that maps its shape onto these tables;
-- a MockAdapter fills them with realistic fake sales today, a real adapter
-- (Cassa in Cloud, Tilby…) drops in tomorrow with zero downstream changes.
--
-- No dependency on the management tables — this migration runs first.
-- supplier_invoice_items.ingredient_id is a NAKED uuid here; the FK is added by
-- 2026-06-08-management-foodcost.sql once the ingredients table exists.

-- ============================================
-- 1. POS connections (one active adapter per tenant; 'mock' by default)
-- ============================================
create table if not exists public.pos_connections (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'mock'
    check (provider in ('mock','cassa_in_cloud','tilby','ipratico','nempos','deliverect')),
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,        -- NON-secret: shop id, cursor…
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('ok','error') or last_sync_status is null),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pos_connections_tenant on public.pos_connections(tenant_id);
create index if not exists idx_pos_connections_active on public.pos_connections(active) where active = true;
create unique index if not exists uq_pos_connections_tenant_provider
  on public.pos_connections(tenant_id, provider);

-- ============================================
-- 2. Encrypted credentials — dedicated table, service-role ONLY (see RLS)
-- ============================================
create table if not exists public.pos_credentials (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.pos_connections(id) on delete cascade,
  secret_enc text not null,                          -- AES-256-GCM (POS_CRED_ENC_KEY)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_pos_credentials_connection unique (connection_id)
);
create index if not exists idx_pos_credentials_tenant on public.pos_credentials(tenant_id);

-- ============================================
-- 3. Canonical sales (fact table SUPERSET: all 5 tills fit inside)
-- ============================================
create table if not exists public.pos_sales (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.pos_connections(id) on delete set null,
  provider text not null,
  external_id text not null,                          -- id in the till → idempotent upsert
  channel text not null default 'sala' check (channel in ('sala','asporto','delivery')),
  channel_source text,                                -- glovo/justeat/… for delivery, else null
  business_date date not null,                        -- service day (local)
  closed_at timestamptz not null,                     -- bill-close timestamp
  currency text not null default 'EUR',
  gross_total numeric(12,2) not null default 0,
  net_total numeric(12,2),
  tax_total numeric(12,2),
  discount_total numeric(12,2) not null default 0,
  fees_total numeric(12,2) not null default 0,        -- aggregator commission (0 for POS)
  tip_total numeric(12,2) not null default 0,
  covers integer,                                     -- coperti: NULL for asporto/delivery
  payment_method text check (payment_method in
    ('cash','card','online','meal_voucher','bank_transfer','other') or payment_method is null),
  order_ref text,
  raw_payload jsonb not null default '{}'::jsonb,     -- original raw record (forensic)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_pos_sales_external unique (tenant_id, provider, external_id)
);
create index if not exists idx_pos_sales_tenant_date on public.pos_sales(tenant_id, business_date desc);
create index if not exists idx_pos_sales_tenant_channel on public.pos_sales(tenant_id, channel, business_date desc);
create index if not exists idx_pos_sales_connection on public.pos_sales(connection_id);

-- ============================================
-- 4. Sale lines (feed food cost via menu_item_id)
-- ============================================
create table if not exists public.pos_sale_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null references public.pos_sales(id) on delete cascade,
  external_product_id text,
  name text not null,
  category text,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(12,2) not null default 0,
  gross_total numeric(12,2) not null default 0,
  tax_rate numeric(5,2),
  menu_item_id uuid references public.menu_items(id) on delete set null,  -- SEAM food-cost
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_pos_sale_items_tenant on public.pos_sale_items(tenant_id);
create index if not exists idx_pos_sale_items_sale on public.pos_sale_items(sale_id);
create index if not exists idx_pos_sale_items_menu_item on public.pos_sale_items(menu_item_id);
create index if not exists idx_pos_sale_items_tenant_product on public.pos_sale_items(tenant_id, external_product_id);

-- ============================================
-- 5. Sync log (one row per attempt)
-- ============================================
create table if not exists public.pos_sync_log (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.pos_connections(id) on delete set null,
  provider text not null,
  trigger text not null default 'cron' check (trigger in ('cron','manual','backfill')),
  status text not null default 'running' check (status in ('running','ok','error')),
  window_from timestamptz,
  window_to timestamptz,
  sales_fetched integer not null default 0,
  sales_upserted integer not null default 0,
  sales_skipped integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_pos_sync_log_tenant on public.pos_sync_log(tenant_id, started_at desc);

-- ============================================
-- 6+7. Supplier invoices (header + lines)
-- ============================================
create table if not exists public.supplier_invoices (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null default 'photo' check (source in ('photo','sdi_xml','manual')),
  supplier_name text,
  supplier_vat text,
  invoice_number text,
  invoice_date date,
  currency text not null default 'EUR',
  net_total numeric(12,2),
  tax_total numeric(12,2),
  gross_total numeric(12,2),
  status text not null default 'parsed' check (status in ('parsed','confirmed','error')),
  raw_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_supplier_invoices_tenant on public.supplier_invoices(tenant_id, invoice_date desc);
create unique index if not exists uq_supplier_invoices_number
  on public.supplier_invoices(tenant_id, supplier_vat, invoice_number)
  where supplier_vat is not null and invoice_number is not null;

create table if not exists public.supplier_invoice_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,3),
  unit text,
  unit_price numeric(12,4),
  line_total numeric(12,2),
  tax_rate numeric(5,2),
  ingredient_id uuid,                                 -- SEAM: FK added by Migration 2
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_sii_tenant on public.supplier_invoice_items(tenant_id);
create index if not exists idx_sii_invoice on public.supplier_invoice_items(invoice_id);
create index if not exists idx_sii_ingredient on public.supplier_invoice_items(ingredient_id);

-- ============================================
-- RLS
-- ============================================
-- pos_sales / pos_sale_items / pos_sync_log: members read-only (the service-role
-- cron writes them; service-role bypasses RLS, so no member write policy).
-- pos_connections / supplier_invoices / supplier_invoice_items: members full
-- (the owner manages them). pos_credentials: NO member policy at all (only the
-- admin policy + service-role bypass can touch secrets). All tables also get the
-- platform-admin policy.
alter table public.pos_connections enable row level security;
alter table public.pos_credentials enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_sale_items enable row level security;
alter table public.pos_sync_log enable row level security;
alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_items enable row level security;

-- Member: full access
create policy "pos_connections tenant access" on public.pos_connections
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
create policy "supplier_invoices tenant access" on public.supplier_invoices
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
create policy "supplier_invoice_items tenant access" on public.supplier_invoice_items
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));

-- Member: SELECT only (writes are service-role)
create policy "pos_sales tenant read" on public.pos_sales
  for select using (private.is_tenant_member(tenant_id));
create policy "pos_sale_items tenant read" on public.pos_sale_items
  for select using (private.is_tenant_member(tenant_id));
create policy "pos_sync_log tenant read" on public.pos_sync_log
  for select using (private.is_tenant_member(tenant_id));

-- pos_credentials: NO member policy (service-role + admin only).

-- Platform admin: full access on every table
create policy "pos_connections admin access" on public.pos_connections
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "pos_credentials admin access" on public.pos_credentials
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "pos_sales admin access" on public.pos_sales
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "pos_sale_items admin access" on public.pos_sale_items
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "pos_sync_log admin access" on public.pos_sync_log
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "supplier_invoices admin access" on public.supplier_invoices
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "supplier_invoice_items admin access" on public.supplier_invoice_items
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

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
