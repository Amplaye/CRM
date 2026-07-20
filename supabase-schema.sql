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
  updated_at timestamptz not null default now(),
  deleted_at timestamptz -- soft delete: hidden from inbox, restorable from Trash for 30 days
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
  category text not null default 'general' check (category in ('policies', 'menu', 'troubleshooting', 'general', 'commerciale')),
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
-- Storage: a PRIVATE "menu-imports" bucket is the staging area for menu-import
-- uploads. The browser PUTs the raw file (PDF/image, ≤25 MB) straight here via a
-- one-time signed URL minted by /api/menu/upload-url, bypassing Vercel's 4.5 MB
-- serverless request-body cap that otherwise rejects large menus (surfacing on
-- iOS Safari as "The string did not match the expected pattern."). The signed
-- URL needs no Storage RLS policy; /api/menu/import-job reads the object back
-- with the service role and deletes it. No public read. Config: private,
-- file_size_limit 26214400 (25 MB), allowed_mime_types null (any).
-- (Created out-of-band via the Storage API like menu-images above.)
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
    check (provider in ('mock','cassa_in_cloud','tilby','ipratico','nempos','deliverect','loyverse')),
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
  waste_pct numeric(5,2) not null default 0,   -- per-line yield loss (food cost only)
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
-- Logs one 'sale' movement per recipe ingredient; the stock_movements trigger
-- applies the delta (see 2026-06-18-management-improvements.sql). Plated qty, not
-- waste-adjusted, so physical count vs system surfaces real shrinkage.
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

-- ============================================
-- 8. Stock movements ledger + overhead (2026-06-18-management-improvements.sql)
-- ============================================
create table if not exists public.stock_movements (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  qty_delta numeric(14,3) not null,            -- signed: − consumes, + adds
  kind text not null check (kind in ('sale','receipt','count','adjustment','waste')),
  reason text,
  unit_cost numeric(12,4),                     -- cost snapshot, to value the ledger
  ref_id uuid,                                 -- originating row (sale/invoice item)
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_tenant_created on public.stock_movements(tenant_id, created_at desc);
create index if not exists idx_stock_movements_ingredient on public.stock_movements(ingredient_id, created_at desc);

-- Trigger: a movement applies its delta to ingredients.stock_qty (single write path).
create or replace function public.fn_apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.ingredients set stock_qty = stock_qty + NEW.qty_delta, updated_at = now()
   where id = NEW.ingredient_id and tenant_id = NEW.tenant_id;
  return NEW;
end $$;
drop trigger if exists trg_apply_stock_movement on public.stock_movements;
create trigger trg_apply_stock_movement after insert on public.stock_movements
  for each row execute function public.fn_apply_stock_movement();

-- Per-batch expiry reminders (2026-07-20-stock-lots.sql). Each goods-in with a
-- shelf life creates a lot (received date, qty, expiry). Lots do NOT drive
-- stock_qty or sale depletion — they are an expiry reminder per delivery batch.
-- A trigger keeps ingredients.expiry_date = earliest OPEN lot (only for
-- ingredients that have lots, so lot-free ones keep their manual date).
create table if not exists public.stock_lots (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  qty numeric(14,3),
  unit text,
  expiry_date date not null,
  received_on date not null default current_date,
  source text not null default 'receipt' check (source in ('receipt','invoice','manual')),
  note text,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_lots_ingredient_open on public.stock_lots(ingredient_id) where status = 'open';
create index if not exists idx_stock_lots_tenant on public.stock_lots(tenant_id, expiry_date);

create or replace function public.fn_sync_ingredient_expiry()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ingredient uuid := coalesce(NEW.ingredient_id, OLD.ingredient_id);
  v_tenant uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
  v_expiry date;
begin
  select min(expiry_date) into v_expiry
    from public.stock_lots
   where ingredient_id = v_ingredient and status = 'open';
  update public.ingredients set expiry_date = v_expiry, updated_at = now()
   where id = v_ingredient and tenant_id = v_tenant;
  return null;
end $$;
drop trigger if exists trg_sync_ingredient_expiry on public.stock_lots;
create trigger trg_sync_ingredient_expiry
  after insert or update or delete on public.stock_lots
  for each row execute function public.fn_sync_ingredient_expiry();

alter table public.stock_lots enable row level security;
drop policy if exists "stock_lots tenant access" on public.stock_lots;
create policy "stock_lots tenant access" on public.stock_lots
  for all using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id));
drop policy if exists "stock_lots admin access" on public.stock_lots;
create policy "stock_lots admin access" on public.stock_lots
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- Monthly fixed costs (rent, utilities…) → real operating margin on the P&L.
create table if not exists public.overhead_costs (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_month date not null,                  -- first day of the month
  category text not null,
  amount numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint overhead_costs_unique unique (tenant_id, period_month, category)
);
create index if not exists idx_overhead_costs_tenant_month on public.overhead_costs(tenant_id, period_month);

-- Invoice line → stock receipt seam.
alter table public.supplier_invoice_items add column if not exists received_at timestamptz;

alter table public.stock_movements enable row level security;
alter table public.overhead_costs enable row level security;
create policy "stock_movements tenant access" on public.stock_movements
  for all using (private.is_tenant_member(tenant_id)) with check (private.is_tenant_member(tenant_id));
create policy "overhead_costs tenant access" on public.overhead_costs
  for all using (private.is_tenant_member(tenant_id)) with check (private.is_tenant_member(tenant_id));
create policy "stock_movements admin access" on public.stock_movements
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "overhead_costs admin access" on public.overhead_costs
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_movements'
  ) then
    alter publication supabase_realtime add table public.stock_movements;
  end if;
end $$;

-- ============================================
-- BILLING / SUBSCRIPTIONS (Settings → Payments) — see supabase/migrations/20260609_billing.sql
-- subscriptions: members read-only (webhooks write via service-role); the active
-- plan/cycle/status/add-ons + provider reference ids. Mirrored into
-- tenants.settings.billing for cheap reads.
-- payment_secrets: encrypted provider material, service-role/admin ONLY (no member
-- policy), identical security shape to pos_credentials.
-- ============================================
create table if not exists public.subscriptions (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan text check (plan in ('premium','business') or plan is null),
  cycle text check (cycle in ('monthly','yearly') or cycle is null),
  status text not null default 'incomplete'
    check (status in ('active','trialing','past_due','canceled','incomplete')),
  provider text check (provider in ('stripe','paypal') or provider is null),
  stripe_customer_id text,
  stripe_subscription_id text,
  paypal_subscription_id text,
  addons text[] not null default '{}',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_subscriptions_tenant unique (tenant_id)
);
create index if not exists idx_subscriptions_tenant on public.subscriptions(tenant_id);
create index if not exists idx_subscriptions_stripe_sub on public.subscriptions(stripe_subscription_id);
create index if not exists idx_subscriptions_paypal_sub on public.subscriptions(paypal_subscription_id);

create table if not exists public.payment_secrets (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('stripe','paypal')),
  secret_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_payment_secrets_tenant_provider unique (tenant_id, provider)
);
create index if not exists idx_payment_secrets_tenant on public.payment_secrets(tenant_id);

alter table public.subscriptions enable row level security;
alter table public.payment_secrets enable row level security;

create policy "subscriptions tenant read" on public.subscriptions
  for select using (private.is_tenant_member(tenant_id));
create policy "subscriptions admin access" on public.subscriptions
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
create policy "payment_secrets admin access" on public.payment_secrets
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- ============================================================================
-- CASSA NATIVA (built-in POS) — folded from scripts/migrations/2026-07-04-cassa.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Daily cash session (giornata di cassa)
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_sessions (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  opened_by uuid,
  opened_by_name text,
  opening_float numeric(10,2) not null default 0,   -- fondo cassa
  closed_at timestamptz,
  closed_by uuid,
  expected_cash numeric(10,2),                      -- float + cash takings, computed at close
  counted_cash numeric(10,2),                       -- what the drawer actually held
  cash_difference numeric(10,2),                    -- counted − expected
  totals jsonb not null default '{}'::jsonb,        -- frozen summary written at close
  notes text,
  created_at timestamptz not null default now()
);

-- One open session per tenant at a time.
create unique index if not exists uq_cassa_sessions_open
  on public.cassa_sessions (tenant_id) where (status = 'open');

create index if not exists idx_cassa_sessions_tenant
  on public.cassa_sessions (tenant_id, opened_at desc);

-- ---------------------------------------------------------------------------
-- 2) Orders (conti) — one live bill per table / counter sale / takeaway
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_orders (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid references public.cassa_sessions(id) on delete set null,
  table_id uuid references public.restaurant_tables(id) on delete set null,
  table_name text not null default '',              -- label snapshot ("Tavolo 4", "Banco"…)
  channel text not null default 'sala' check (channel in ('sala','asporto','delivery')),
  status text not null default 'open' check (status in ('open','paid','cancelled','void')),
  covers integer not null default 0,
  cover_unit numeric(10,2) not null default 0,      -- coperto per person (snapshot)
  discount_type text check (discount_type in ('percent','amount') or discount_type is null),
  discount_value numeric(10,2) not null default 0,
  subtotal numeric(10,2) not null default 0,        -- denormalized, recomputed server-side
  total numeric(10,2) not null default 0,
  notes text,
  opened_by uuid,
  opened_by_name text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  receipt_number integer,                           -- assigned at payment
  receipt_year integer,
  receipt_date date,                                -- business date in the venue tz
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cassa_orders_tenant_status
  on public.cassa_orders (tenant_id, status);
create index if not exists idx_cassa_orders_tenant_receipt_date
  on public.cassa_orders (tenant_id, receipt_date desc);
create index if not exists idx_cassa_orders_session
  on public.cassa_orders (session_id);

-- ---------------------------------------------------------------------------
-- 3) Order lines (righe comanda)
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_order_items (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.cassa_orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,                               -- snapshot: survives menu edits
  unit_price numeric(10,2) not null default 0,      -- snapshot: survives price changes
  qty numeric(10,2) not null default 1 check (qty > 0),
  course integer not null default 1,                -- portata (1ª, 2ª, 3ª…)
  comanda_no integer not null default 1,            -- firing round the line went out with
  notes text,
  status text not null default 'sent' check (status in ('sent','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_cassa_order_items_order
  on public.cassa_order_items (order_id);
create index if not exists idx_cassa_order_items_tenant
  on public.cassa_order_items (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4) Payments — several rows per order = split bill / mixed methods
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_payments (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.cassa_orders(id) on delete cascade,
  method text not null check (method in ('cash','card','online','meal_voucher','bank_transfer','other')),
  amount numeric(10,2) not null,                    -- applied to the bill
  received numeric(10,2),                           -- cash tendered (change = received − amount)
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_cassa_payments_order
  on public.cassa_payments (order_id);
create index if not exists idx_cassa_payments_tenant
  on public.cassa_payments (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Receipt numbering — per tenant, per year, gapless & concurrency-safe
-- ---------------------------------------------------------------------------
create table if not exists public.cassa_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  year integer not null,
  last_number integer not null default 0,
  primary key (tenant_id, year)
);

create or replace function public.fn_cassa_next_receipt(p_tenant_id uuid, p_year integer)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_next integer;
begin
  insert into public.cassa_counters (tenant_id, year, last_number)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, year)
  do update set last_number = cassa_counters.last_number + 1
  returning last_number into v_next;
  return v_next;
end $$;

revoke execute on function public.fn_cassa_next_receipt(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) RLS — members read, service role writes (via /api/cassa), admins full
-- ---------------------------------------------------------------------------
alter table public.cassa_sessions enable row level security;
alter table public.cassa_orders enable row level security;
alter table public.cassa_order_items enable row level security;
alter table public.cassa_payments enable row level security;
alter table public.cassa_counters enable row level security;

drop policy if exists "cassa_sessions tenant read" on public.cassa_sessions;
create policy "cassa_sessions tenant read" on public.cassa_sessions
  for select using (private.is_tenant_member(tenant_id));
drop policy if exists "cassa_orders tenant read" on public.cassa_orders;
create policy "cassa_orders tenant read" on public.cassa_orders
  for select using (private.is_tenant_member(tenant_id));
drop policy if exists "cassa_order_items tenant read" on public.cassa_order_items;
create policy "cassa_order_items tenant read" on public.cassa_order_items
  for select using (private.is_tenant_member(tenant_id));
drop policy if exists "cassa_payments tenant read" on public.cassa_payments;
create policy "cassa_payments tenant read" on public.cassa_payments
  for select using (private.is_tenant_member(tenant_id));
-- cassa_counters: no member policy (service-role only), admin below.

drop policy if exists "cassa_sessions admin access" on public.cassa_sessions;
create policy "cassa_sessions admin access" on public.cassa_sessions
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "cassa_orders admin access" on public.cassa_orders;
create policy "cassa_orders admin access" on public.cassa_orders
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "cassa_order_items admin access" on public.cassa_order_items;
create policy "cassa_order_items admin access" on public.cassa_order_items
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "cassa_payments admin access" on public.cassa_payments;
create policy "cassa_payments admin access" on public.cassa_payments
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "cassa_counters admin access" on public.cassa_counters;
create policy "cassa_counters admin access" on public.cassa_counters
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 7) v2: varianti, IVA per articolo, reparto comanda (cucina/bar/pizzeria)
-- ---------------------------------------------------------------------------
-- menu_items carries the CATALOG values; cassa_order_items snapshots them per
-- line at fire time (a VAT/station/variant change must not rewrite old bills).
alter table public.menu_items
  add column if not exists vat_rate numeric(4,2) not null default 10,
  add column if not exists station text,
  add column if not exists variants jsonb not null default '[]'::jsonb;

alter table public.cassa_order_items
  add column if not exists vat_rate numeric(4,2),
  add column if not exists station text,
  add column if not exists variants jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 8) Realtime — the /cassa screen live-updates across devices
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cassa_orders'
  ) then
    alter publication supabase_realtime add table public.cassa_orders;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cassa_order_items'
  ) then
    alter publication supabase_realtime add table public.cassa_order_items;
  end if;
end $$;

-- ============================================
-- VERI*FACTU FISCAL REGISTER (added 2026-07-14)
-- Mirror of scripts/migrations/2026-07-14-fiscal-verifactu.sql (repo convention:
-- migrations are applied by hand and reflected here).
-- ============================================
-- ============================================================================
-- VERI*FACTU — registro de facturación (RD 1007/2023 + Orden HAC/1177/2024)
-- 2026-07-14
--
-- What this adds, and why it is shaped this way:
--
--   • THE CHAIN IS PER NIF, NOT PER TENANT. Art. 2 of the Orden + art. 7 RRSIF
--     require the software to behave as N logically independent SIF, one per
--     obligado tributario. So `fiscal_obligados` (the NIF) owns the chain and a
--     tenant POINTS AT one. Two venues under the same NIF share a chain; a venue
--     can never sit on two.
--
--   • `fiscal_records` IS PHYSICALLY IMMUTABLE. A BEFORE UPDATE/DELETE/TRUNCATE
--     trigger always raises — for the service_role too. Everything that legally
--     MUST mutate (send status, attempts, AEAT's answer) lives in the separate
--     `fiscal_submissions` table. That split is what lets the register be truly
--     append-only AND still have a working send queue.
--
--   • THE HUELLA IS COMPUTED IN SQL, inside the same transaction that locks the
--     chain head (`select … for update`). Computing it in the app would let two
--     tills cashing at the same instant read the same prev_huella and fork the
--     chain. src/lib/fiscal/huella.ts mirrors these functions and a unit test
--     asserts both produce AEAT's published golden vector.
--
--   • THE MONEY MATH STAYS IN TYPESCRIPT. src/lib/cassa/totals.ts is already
--     cent-exact (largest-remainder discount spreading) and tested. The RPC takes
--     the desglose as jsonb and VERIFIES its internal coherence (bases + cuotas
--     must add up to the totals) rather than recomputing it in plpgsql.
--
-- Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) The obligado tributario — the owner of a chain
-- ---------------------------------------------------------------------------
create table if not exists public.fiscal_obligados (
  id uuid default uuid_generate_v4() primary key,
  nif text not null unique,                          -- normalized: uppercase, alphanumeric only
  razon_social text not null default '',
  domicilio jsonb not null default '{}'::jsonb,      -- { via, cp, municipio, provincia, pais }
  regimen text not null default 'iva_peninsular'
    check (regimen in ('iva_peninsular','igic_canarias')),
  -- WHO issues the invoices for this NIF. Exactly one is true, and `none` is the
  -- non-compliant combination we must BLOCK rather than paper over:
  --   native   → our cassa issues; we are the SIF; we send to AEAT.
  --   external → an already-compliant external POS issues; we send NOTHING and
  --              only import its sales for analytics.
  --   none     → nobody is compliant. The cassa refuses to take money.
  sif_mode text not null default 'none'
    check (sif_mode in ('native','external','none')),
  -- Verifacti (colaborador social) holds the certificate and the representation
  -- mandate; this is their id for this NIF. Null until onboarding completes.
  verifacti_nif_id text,
  mandate_signed_at timestamptz,
  mandate_evidence jsonb not null default '{}'::jsonb,  -- signature id, document url, ip, timestamp
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A NIF is only ever compared in its normalized form — "B-12345678 " and
-- "b12345678" are the same taxpayer and must never open two chains.
create or replace function public.fn_fiscal_normalize_nif()
returns trigger language plpgsql as $$
begin
  new.nif := upper(regexp_replace(coalesce(new.nif,''), '[^A-Za-z0-9]', '', 'g'));
  if new.nif = '' then
    raise exception 'fiscal_obligados.nif cannot be empty';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_fiscal_normalize_nif on public.fiscal_obligados;
create trigger trg_fiscal_normalize_nif
  before insert or update on public.fiscal_obligados
  for each row execute function public.fn_fiscal_normalize_nif();

-- A tenant belongs to at most ONE obligado. `fiscal_serie` disambiguates the
-- numbering when several venues share a NIF (and therefore a chain): the series
-- prefix keeps NumSerieFactura unique across the chain.
alter table public.tenants
  add column if not exists fiscal_obligado_id uuid references public.fiscal_obligados(id) on delete set null;
alter table public.tenants
  add column if not exists fiscal_serie text not null default '';

create index if not exists idx_tenants_fiscal_obligado
  on public.tenants (fiscal_obligado_id) where fiscal_obligado_id is not null;

-- The invoice number AEAT knows this ticket by, denormalized onto the order so a
-- receipt can be RE-PRINTED (with its QR) months later without walking the chain.
alter table public.cassa_orders
  add column if not exists fiscal_num_serie text;

-- ---------------------------------------------------------------------------
-- 2) The head of each chain — the row that serializes concurrent payments
-- ---------------------------------------------------------------------------
create table if not exists public.fiscal_chain_heads (
  obligado_id uuid primary key references public.fiscal_obligados(id) on delete cascade,
  last_huella text,                                  -- null → the chain is empty (PrimerRegistro="S")
  last_record_id uuid,
  record_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3) The register — APPEND-ONLY
-- ---------------------------------------------------------------------------
create table if not exists public.fiscal_records (
  id uuid default uuid_generate_v4() primary key,
  obligado_id uuid not null references public.fiscal_obligados(id) on delete restrict,
  -- Which venue emitted it. Nullable-on-delete so a tenant purge can never take a
  -- fiscal record with it (the register outlives the CRM account: 4-year duty).
  tenant_id uuid references public.tenants(id) on delete set null,
  tipo text not null check (tipo in ('alta','anulacion')),
  num_serie text not null,                           -- e.g. "2026/000123" (with the tenant's serie prefix)
  fecha_expedicion date not null,
  -- F2 = factura simplificada (our tickets). R5 = rectificativa de simplificada.
  tipo_factura text not null default 'F2'
    check (tipo_factura in ('F1','F2','R1','R2','R3','R4','R5')),
  -- Per-rate breakdown, AEAT field names:
  -- [{ Impuesto, ClaveRegimen, CalificacionOperacion, TipoImpositivo,
  --    BaseImponible, CuotaRepercutida }]
  desglose jsonb not null default '[]'::jsonb,
  cuota_total numeric(12,2) not null default 0,
  importe_total numeric(12,2) not null default 0,
  -- Rectificativa linkage: { TipoRectificativa, FacturasRectificadas: [{num_serie, fecha}] }
  rectifica jsonb,
  prev_huella text,                                  -- null only for the first record of a chain
  huella text not null,
  fecha_hora_huso text not null,                     -- ISO-8601 WITH the venue's offset, e.g. 2026-07-14T13:05:00+02:00
  sistema_informatico jsonb not null default '{}'::jsonb,  -- the machine-readable echo of our declaración responsable
  cassa_order_id uuid references public.cassa_orders(id) on delete set null,
  chain_index bigint not null,
  created_at timestamptz not null default now(),
  -- One alta and at most one anulacion per invoice number, per chain.
  unique (obligado_id, tipo, num_serie)
);

create index if not exists idx_fiscal_records_obligado
  on public.fiscal_records (obligado_id, chain_index);
create index if not exists idx_fiscal_records_tenant
  on public.fiscal_records (tenant_id, created_at desc);
create index if not exists idx_fiscal_records_order
  on public.fiscal_records (cassa_order_id) where cassa_order_id is not null;

-- INALTERABILIDAD (art. 7.2 RRSIF). This trigger is the whole guarantee: without
-- it "append-only" is a convention, and a convention is not a register.
-- Modelled on trg_prevent_global_role_change — but with NO service_role escape
-- hatch, because the point is that not even we can rewrite a ticket.
create or replace function public.fn_fiscal_records_immutable()
returns trigger language plpgsql as $$
begin
  raise exception
    'fiscal_records is append-only (RRSIF art. 7 — inalterabilidad): % is not permitted. Correct a record by chaining an anulacion or a rectificativa.',
    tg_op;
end $$;

drop trigger if exists trg_fiscal_records_immutable on public.fiscal_records;
create trigger trg_fiscal_records_immutable
  before update or delete on public.fiscal_records
  for each row execute function public.fn_fiscal_records_immutable();

drop trigger if exists trg_fiscal_records_no_truncate on public.fiscal_records;
create trigger trg_fiscal_records_no_truncate
  before truncate on public.fiscal_records
  for each statement execute function public.fn_fiscal_records_immutable();

-- ---------------------------------------------------------------------------
-- 4) The send queue — MUTABLE, deliberately a separate table
-- ---------------------------------------------------------------------------
create table if not exists public.fiscal_submissions (
  id uuid default uuid_generate_v4() primary key,
  record_id uuid not null unique references public.fiscal_records(id) on delete restrict,
  obligado_id uuid not null references public.fiscal_obligados(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','sent','accepted','accepted_with_errors','rejected')),
  attempts integer not null default 0,
  next_retry_at timestamptz not null default now(),
  last_error text,
  aeat_csv text,                                     -- the CSV AEAT returns on acceptance
  provider_response jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The queue claim reads exactly this: what is due, oldest first.
create index if not exists idx_fiscal_submissions_due
  on public.fiscal_submissions (next_retry_at)
  where status in ('pending','sent');
create index if not exists idx_fiscal_submissions_tenant
  on public.fiscal_submissions (tenant_id, status);

-- ---------------------------------------------------------------------------
-- 5) The huella — SQL side (mirrored by src/lib/fiscal/huella.ts)
-- ---------------------------------------------------------------------------

-- SHA-256 → 64 UPPERCASE hex chars. Lowercase hex is a rejected record.
--
-- `extensions.digest` is SCHEMA-QUALIFIED on purpose: pgcrypto lives in the
-- `extensions` schema on Supabase, and every function that chains a record is
-- security definer with `search_path = public, pg_temp` (as it must be — a
-- security definer with a loose search_path is a privilege-escalation hole). An
-- unqualified digest() therefore resolves fine from a plain query and NOT from
-- inside the chain, which fails exactly where it hurts most.
create or replace function public.fn_fiscal_huella(p_payload text)
returns text language sql immutable as $$
  select upper(encode(extensions.digest(p_payload, 'sha256'), 'hex'));
$$;

-- 2 decimals, dot separator, no grouping — the literal text that goes in the XML.
create or replace function public.fn_fiscal_amount(p_n numeric)
returns text language sql immutable as $$
  select to_char(coalesce(p_n, 0), 'FM9999999999990.00');
$$;

-- The canonical string of a RegistroAlta. Field order is AEAT's and is part of
-- the spec: change it and every hash in the chain becomes wrong.
create or replace function public.fn_fiscal_alta_payload(
  p_nif text,
  p_num_serie text,
  p_fecha_expedicion date,
  p_tipo_factura text,
  p_cuota_total numeric,
  p_importe_total numeric,
  p_prev_huella text,
  p_fecha_hora_huso text
) returns text language sql immutable as $$
  select 'IDEmisorFactura=' || coalesce(p_nif,'')
      || '&NumSerieFactura=' || coalesce(p_num_serie,'')
      || '&FechaExpedicionFactura=' || to_char(p_fecha_expedicion, 'DD-MM-YYYY')
      || '&TipoFactura=' || coalesce(p_tipo_factura,'')
      || '&CuotaTotal=' || public.fn_fiscal_amount(p_cuota_total)
      || '&ImporteTotal=' || public.fn_fiscal_amount(p_importe_total)
      || '&Huella=' || coalesce(p_prev_huella,'')
      || '&FechaHoraHusoGenRegistro=' || coalesce(p_fecha_hora_huso,'');
$$;

-- The canonical string of a RegistroAnulacion. It names the invoice being killed;
-- an annulment is not an invoice of its own.
create or replace function public.fn_fiscal_anulacion_payload(
  p_nif text,
  p_num_serie text,
  p_fecha_expedicion date,
  p_prev_huella text,
  p_fecha_hora_huso text
) returns text language sql immutable as $$
  select 'IDEmisorFacturaAnulada=' || coalesce(p_nif,'')
      || '&NumSerieFacturaAnulada=' || coalesce(p_num_serie,'')
      || '&FechaExpedicionFacturaAnulada=' || to_char(p_fecha_expedicion, 'DD-MM-YYYY')
      || '&Huella=' || coalesce(p_prev_huella,'')
      || '&FechaHoraHusoGenRegistro=' || coalesce(p_fecha_hora_huso,'');
$$;

-- ---------------------------------------------------------------------------
-- 6) Desglose coherence — the RPC verifies, it does not recompute
-- ---------------------------------------------------------------------------
-- Raises unless every line's Base + Cuota adds up to the invoice totals it claims.
-- A ticket whose breakdown doesn't add up is rejected by AEAT *after* the guest
-- has left with the receipt, so we refuse it while we can still say no.
create or replace function public.fn_fiscal_assert_desglose(
  p_desglose jsonb,
  p_cuota_total numeric,
  p_importe_total numeric
) returns void language plpgsql immutable as $$
declare
  v_base numeric := 0;
  v_cuota numeric := 0;
  v_line jsonb;
begin
  if jsonb_typeof(p_desglose) <> 'array' or jsonb_array_length(p_desglose) = 0 then
    raise exception 'fiscal: desglose must be a non-empty array';
  end if;

  for v_line in select * from jsonb_array_elements(p_desglose) loop
    if coalesce(v_line->>'Impuesto','') = '' then
      -- AEAT silently assumes 01 (IVA) when Impuesto is missing: a Canary ticket
      -- would be filed as mainland VAT and nobody would notice for a year.
      raise exception 'fiscal: desglose line without an explicit Impuesto (01 IVA / 03 IGIC)';
    end if;
    v_base := v_base + coalesce((v_line->>'BaseImponible')::numeric, 0);
    v_cuota := v_cuota + coalesce((v_line->>'CuotaRepercutida')::numeric, 0);
  end loop;

  if round(v_cuota, 2) <> round(coalesce(p_cuota_total,0), 2) then
    raise exception 'fiscal: CuotaTotal % does not match the sum of the desglose (%)',
      p_cuota_total, v_cuota;
  end if;
  if round(v_base + v_cuota, 2) <> round(coalesce(p_importe_total,0), 2) then
    raise exception 'fiscal: ImporteTotal % does not match Base+Cuota of the desglose (%)',
      p_importe_total, v_base + v_cuota;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Appending to the chain — always under the head lock
-- ---------------------------------------------------------------------------
-- Called from inside fn_cassa_pay_atomic / fn_cassa_void_atomic, i.e. always in a
-- transaction that has already done its own work. `for update` on the head row is
-- what serializes two tills cashing in the same millisecond: the second waits,
-- reads the first one's huella, and the chain stays a chain.
create or replace function public.fn_fiscal_append(
  p_obligado_id uuid,
  p_tenant_id uuid,
  p_tipo text,
  p_num_serie text,
  p_fecha_expedicion date,
  p_tipo_factura text,
  p_desglose jsonb,
  p_cuota_total numeric,
  p_importe_total numeric,
  p_fecha_hora_huso text,
  p_sistema jsonb,
  p_cassa_order_id uuid,
  p_rectifica jsonb default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nif text;
  v_prev text;
  v_count bigint;
  v_payload text;
  v_huella text;
  v_id uuid;
begin
  select nif into v_nif from public.fiscal_obligados where id = p_obligado_id;
  if v_nif is null then
    raise exception 'fiscal: unknown obligado %', p_obligado_id;
  end if;

  if p_tipo = 'alta' then
    perform public.fn_fiscal_assert_desglose(p_desglose, p_cuota_total, p_importe_total);
  end if;

  -- Create the head on first use, then LOCK it. Both tills that race here take
  -- this same row, so exactly one of them can be reading prev_huella at a time.
  insert into public.fiscal_chain_heads (obligado_id)
  values (p_obligado_id)
  on conflict (obligado_id) do nothing;

  select last_huella, record_count into v_prev, v_count
  from public.fiscal_chain_heads
  where obligado_id = p_obligado_id
  for update;

  if p_tipo = 'alta' then
    v_payload := public.fn_fiscal_alta_payload(
      v_nif, p_num_serie, p_fecha_expedicion, p_tipo_factura,
      p_cuota_total, p_importe_total, v_prev, p_fecha_hora_huso);
  else
    v_payload := public.fn_fiscal_anulacion_payload(
      v_nif, p_num_serie, p_fecha_expedicion, v_prev, p_fecha_hora_huso);
  end if;
  v_huella := public.fn_fiscal_huella(v_payload);

  insert into public.fiscal_records (
    obligado_id, tenant_id, tipo, num_serie, fecha_expedicion, tipo_factura,
    desglose, cuota_total, importe_total, rectifica,
    prev_huella, huella, fecha_hora_huso, sistema_informatico,
    cassa_order_id, chain_index
  ) values (
    p_obligado_id, p_tenant_id, p_tipo, p_num_serie, p_fecha_expedicion, p_tipo_factura,
    coalesce(p_desglose, '[]'::jsonb), coalesce(p_cuota_total, 0), coalesce(p_importe_total, 0), p_rectifica,
    v_prev, v_huella, p_fecha_hora_huso, coalesce(p_sistema, '{}'::jsonb),
    p_cassa_order_id, v_count + 1
  ) returning id into v_id;

  update public.fiscal_chain_heads
     set last_huella = v_huella,
         last_record_id = v_id,
         record_count = v_count + 1,
         updated_at = now()
   where obligado_id = p_obligado_id;

  -- Queue it. Inline sending happens right after COMMIT; this row is the promise
  -- that it gets there even if the network is down and the browser is closed.
  insert into public.fiscal_submissions (record_id, obligado_id, tenant_id)
  values (v_id, p_obligado_id, p_tenant_id);

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 8) Verify a whole chain — recompute every huella from scratch
-- ---------------------------------------------------------------------------
-- The auditable claim of the whole system: run this and the stored hashes must
-- come back out. Used by the fiscal E2E and by Settings → Fiscale.
create or replace function public.fn_fiscal_verify_chain(p_obligado_id uuid)
returns table (ok boolean, checked bigint, first_broken_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nif text;
  v_prev text := null;
  v_rec record;
  v_expected text;
  v_n bigint := 0;
begin
  select nif into v_nif from public.fiscal_obligados where id = p_obligado_id;

  for v_rec in
    select * from public.fiscal_records
     where obligado_id = p_obligado_id
     order by chain_index
  loop
    if v_rec.tipo = 'alta' then
      v_expected := public.fn_fiscal_huella(public.fn_fiscal_alta_payload(
        v_nif, v_rec.num_serie, v_rec.fecha_expedicion, v_rec.tipo_factura,
        v_rec.cuota_total, v_rec.importe_total, v_prev, v_rec.fecha_hora_huso));
    else
      v_expected := public.fn_fiscal_huella(public.fn_fiscal_anulacion_payload(
        v_nif, v_rec.num_serie, v_rec.fecha_expedicion, v_prev, v_rec.fecha_hora_huso));
    end if;

    if v_expected <> v_rec.huella or coalesce(v_rec.prev_huella,'') <> coalesce(v_prev,'') then
      ok := false; checked := v_n; first_broken_id := v_rec.id;
      return next;
      return;
    end if;

    v_prev := v_rec.huella;
    v_n := v_n + 1;
  end loop;

  ok := true; checked := v_n; first_broken_id := null;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- 9) fn_cassa_pay_atomic — ONE transaction for the whole money moment
-- ---------------------------------------------------------------------------
-- Replaces the claim-then-number-then-hope sequence in pay/route.ts. Before this,
-- an order was flipped to `paid` and the receipt number was minted in a SEPARATE
-- statement: if the second failed, the number was burned and the sequence had a
-- hole. Merely annoying in Italy; FATAL under a chained register, where a hole is
-- an unexplainable gap in a hash chain.
--
-- Everything here commits or nothing does: claim → number → fiscal record →
-- canonical sale. A rejected desglose therefore leaves the order OPEN and the
-- counter untouched — the till says no, which is the only honest answer.
create or replace function public.fn_cassa_pay_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_session_id uuid,
  p_business_date date,
  p_year integer,
  p_closed_at timestamptz,
  p_subtotal numeric,
  p_total numeric,
  p_discount numeric,
  p_net_total numeric,
  p_cuota_total numeric,
  p_desglose jsonb,
  p_channel text,
  p_covers integer,
  p_payment_method text,
  -- fiscal (ES) — all null/false for Italy, which stops after step 4
  p_fiscal boolean default false,
  p_obligado_id uuid default null,
  p_serie text default '',
  p_fecha_hora_huso text default null,
  p_sistema jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_claimed uuid;
  v_no integer;
  v_num_serie text;
  v_sale_id uuid;
  v_record_id uuid := null;
  v_huella text := null;
begin
  -- 1) claim the bill (double-tap safe)
  update public.cassa_orders
     set status = 'paid',
         closed_at = p_closed_at,
         session_id = p_session_id,
         subtotal = p_subtotal,
         total = p_total,
         receipt_date = p_business_date,
         receipt_year = p_year,
         updated_at = now()
   where id = p_order_id
     and tenant_id = p_tenant_id
     and status = 'open'
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- 2) mint the receipt number (gapless: same transaction as the claim)
  insert into public.cassa_counters (tenant_id, year, last_number)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, year)
  do update set last_number = cassa_counters.last_number + 1
  returning last_number into v_no;

  v_num_serie := coalesce(p_serie,'') || p_year::text || '/' || lpad(v_no::text, 6, '0');

  update public.cassa_orders
     set receipt_number = v_no,
         fiscal_num_serie = case when p_fiscal then v_num_serie else null end
   where id = p_order_id;

  -- 3) the canonical sale — now WITH its fiscal breakdown, which until today was
  --    computed for the printout and thrown away (net_total/tax_total were null).
  insert into public.pos_sales (
    tenant_id, provider, external_id, channel, business_date, closed_at, currency,
    gross_total, net_total, tax_total, discount_total, covers, payment_method,
    order_ref, raw_payload
  ) values (
    p_tenant_id, 'cassa', p_order_id::text, p_channel, p_business_date, p_closed_at, 'EUR',
    p_total, p_net_total, p_cuota_total, coalesce(p_discount,0),
    case when p_channel = 'sala' and coalesce(p_covers,0) > 0 then p_covers else null end,
    p_payment_method,
    'cassa #' || v_no || '/' || p_year,
    jsonb_build_object(
      'source', 'cassa_nativa',
      'order_id', p_order_id,
      'receipt_number', v_no,
      'receipt_year', p_year,
      'num_serie', v_num_serie,
      'desglose', coalesce(p_desglose, '[]'::jsonb)
    )
  ) returning id into v_sale_id;

  -- 4) Italy stops here. Spain chains the record — in THIS transaction, so a
  --    rejected record un-cashes the bill instead of leaving an unregistered sale.
  if p_fiscal then
    if p_obligado_id is null or p_fecha_hora_huso is null then
      raise exception 'fiscal: obligado_id and fecha_hora_huso are required when p_fiscal is true';
    end if;
    v_record_id := public.fn_fiscal_append(
      p_obligado_id, p_tenant_id, 'alta', v_num_serie, p_business_date, 'F2',
      p_desglose, p_cuota_total, p_total, p_fecha_hora_huso, p_sistema, p_order_id, null);
    select huella into v_huella from public.fiscal_records where id = v_record_id;
  end if;

  return jsonb_build_object(
    'claimed', true,
    'receipt_number', v_no,
    'receipt_year', p_year,
    'num_serie', v_num_serie,
    'sale_id', v_sale_id,
    'fiscal_record_id', v_record_id,
    'huella', v_huella
  );
end $$;

-- ---------------------------------------------------------------------------
-- 10) fn_cassa_void_atomic — an annulment is a RECORD, never a DELETE
-- ---------------------------------------------------------------------------
-- void/route.ts used to `delete from pos_sales`: it physically erased a sale that
-- had already been cashed. Under a fiscal register that is exactly the act the
-- law forbids. Now the order flips to `void`, a RegistroAnulacion is chained, and
-- pos_sales gets a COMPENSATING NEGATIVE ROW. Analytics still add up (the pair
-- sums to zero) and nothing is ever removed.
create or replace function public.fn_cassa_void_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_reason text,
  p_voided_by uuid,
  p_business_date date,
  p_closed_at timestamptz,
  p_fiscal boolean default false,
  p_obligado_id uuid default null,
  p_fecha_hora_huso text default null,
  p_sistema jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.cassa_orders%rowtype;
  v_sale public.pos_sales%rowtype;
  v_num_serie text;
  v_record_id uuid := null;
begin
  update public.cassa_orders
     set status = 'void',
         void_reason = p_reason,
         voided_at = p_closed_at,
         voided_by = p_voided_by,
         updated_at = now()
   where id = p_order_id
     and tenant_id = p_tenant_id
     and status = 'paid'
  returning * into v_order;

  if v_order.id is null then
    return jsonb_build_object('voided', false);
  end if;

  -- The original canonical sale (may be absent on very old orders).
  select * into v_sale
    from public.pos_sales
   where tenant_id = p_tenant_id and provider = 'cassa' and external_id = p_order_id::text
   order by created_at
   limit 1;

  v_num_serie := coalesce(v_sale.raw_payload->>'num_serie', '');
  if v_num_serie = '' then
    v_num_serie := coalesce(v_order.receipt_year::text, '') || '/' ||
                   lpad(coalesce(v_order.receipt_number, 0)::text, 6, '0');
  end if;

  -- The compensating row: same shape, opposite sign. Never a delete.
  if v_sale.id is not null then
    insert into public.pos_sales (
      tenant_id, provider, external_id, channel, business_date, closed_at, currency,
      gross_total, net_total, tax_total, discount_total, covers, payment_method,
      order_ref, raw_payload
    ) values (
      p_tenant_id, 'cassa', p_order_id::text || ':void', v_sale.channel, p_business_date, p_closed_at, 'EUR',
      -v_sale.gross_total, -coalesce(v_sale.net_total,0), -coalesce(v_sale.tax_total,0),
      -coalesce(v_sale.discount_total,0),
      case when v_sale.covers is not null then -v_sale.covers else null end,
      v_sale.payment_method,
      'annullo ' || coalesce(v_sale.order_ref, v_num_serie),
      jsonb_build_object(
        'source', 'cassa_nativa',
        'void_of', p_order_id,
        'num_serie', v_num_serie,
        'reason', p_reason
      )
    );
  end if;

  if p_fiscal then
    if p_obligado_id is null or p_fecha_hora_huso is null then
      raise exception 'fiscal: obligado_id and fecha_hora_huso are required when p_fiscal is true';
    end if;
    v_record_id := public.fn_fiscal_append(
      p_obligado_id, p_tenant_id, 'anulacion', v_num_serie,
      coalesce(v_order.receipt_date, p_business_date), 'F2',
      '[]'::jsonb, 0, 0, p_fecha_hora_huso, p_sistema, p_order_id, null);
  end if;

  return jsonb_build_object(
    'voided', true,
    'num_serie', v_num_serie,
    'fiscal_record_id', v_record_id
  );
end $$;

-- ---------------------------------------------------------------------------
-- 11) The send queue claim — concurrency-safe, one worker or ten
-- ---------------------------------------------------------------------------
create or replace function public.fn_fiscal_claim_pending(p_limit integer default 50)
returns setof public.fiscal_submissions
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with due as (
    select s.id from public.fiscal_submissions s
     join public.fiscal_obligados o on o.id = s.obligado_id
     where s.status in ('pending','sent')
       and s.next_retry_at <= now()
       -- ONLY a `native` obligado is ever transmitted. Defence in depth for the rule
       -- that matters most: when the venue's own POS is the compliant SIF (`external`)
       -- it is already filing these sales itself — sending ours too would give AEAT
       -- the same ticket twice, from two different systems. And an obligado in `none`
       -- has no business filing at all. The pay route already refuses to REGISTER for
       -- those modes; this makes sure that even a record that somehow exists can never
       -- LEAVE the building.
       and o.sif_mode = 'native'
     order by s.created_at
     limit greatest(1, coalesce(p_limit, 50))
     for update of s skip locked     -- two flushes running at once never take the same row
  )
  update public.fiscal_submissions s
     set attempts = s.attempts + 1,
         status = 'sent',
         sent_at = now(),
         -- Backoff while we wait for the answer: 1min, 2, 4, 8… capped at 1h,
         -- which is also the law's outer bound (art. 17: retry at least hourly).
         next_retry_at = now() + least(interval '1 hour',
                                       (interval '1 minute') * power(2, least(s.attempts, 6))),
         updated_at = now()
    from due
   where s.id = due.id
  returning s.*;
end $$;

-- ---------------------------------------------------------------------------
-- 12) RLS — read-only for members, invisible for the obligado
-- ---------------------------------------------------------------------------
alter table public.fiscal_obligados enable row level security;
alter table public.fiscal_chain_heads enable row level security;
alter table public.fiscal_records enable row level security;
alter table public.fiscal_submissions enable row level security;

-- Members may READ their own register (the law requires the pending count to be
-- visible to them) but may never write it: every write goes through the RPCs,
-- which run as service_role. Same shape as pos_sales.
drop policy if exists "fiscal_records tenant read" on public.fiscal_records;
create policy "fiscal_records tenant read" on public.fiscal_records
  for select using (private.is_tenant_member(tenant_id));

drop policy if exists "fiscal_submissions tenant read" on public.fiscal_submissions;
create policy "fiscal_submissions tenant read" on public.fiscal_submissions
  for select using (private.is_tenant_member(tenant_id));

-- fiscal_obligados / fiscal_chain_heads: NO member policy at all. The obligado row
-- carries the representation mandate that lets us file on the client's behalf —
-- the same reason pos_credentials has no member policy. Read it via the API, which
-- checks the role, not via a browser query.

drop policy if exists "fiscal_obligados admin access" on public.fiscal_obligados;
create policy "fiscal_obligados admin access" on public.fiscal_obligados
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "fiscal_chain_heads admin access" on public.fiscal_chain_heads;
create policy "fiscal_chain_heads admin access" on public.fiscal_chain_heads
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "fiscal_records admin access" on public.fiscal_records;
create policy "fiscal_records admin access" on public.fiscal_records
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
drop policy if exists "fiscal_submissions admin access" on public.fiscal_submissions;
create policy "fiscal_submissions admin access" on public.fiscal_submissions
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());


-- ===== VeriFactu: rettificative R5 (2026-07-13) =====
-- VeriFactu — rettificative R5 (reso / storno parziale dopo il pagamento)
--
-- Il pezzo mancante della Fase 2. Fino a oggi la cassa sapeva fare una cosa sola
-- quando un incasso andava corretto: annullarlo TUTTO (fn_cassa_void_atomic). Ma
-- il caso vero al banco non è quasi mai quello: il cliente ha pagato cinque birre,
-- due erano sbagliate, si restituiscono quelle. Annullare l'intero scontrino per
-- rendere 8 € su 40 è una bugia contabile — cancella un incasso che è avvenuto.
--
-- La forma corretta, sotto RD 1007/2023, è una FATTURA RETTIFICATIVA: un NUOVO
-- documento, con un NUOVO numero, che entra in catena come un `alta` di tipo R5
-- (rectificativa de factura simplificada) e che PUNTA all'originale tramite il
-- campo `rectifica`. L'originale resta esattamente dov'era, valido e immutabile.
--
-- Perché "por diferencias" e non "por sustitución" (art. 15 RD 1619/2012 lascia
-- entrambe): per diferencias la rettificativa porta SOLO il delta — qui, importi
-- NEGATIVI pari a ciò che si rende. È l'unica delle due che si compone senza
-- ambiguità con una catena append-only: non "riscrive" l'originale, gli si somma.
--
-- Invarianti (le stesse del resto del modulo, ripetute qui perché è dove si
-- rompono più facilmente):
--   • Una riga compensativa NEGATIVA in pos_sales, mai una DELETE né una UPDATE.
--   • Tutto in UNA transazione: se il record fiscale viene rifiutato, il reso non
--     è avvenuto — meglio un cassiere che riprova che un rimborso senza registro.
--   • Non si può rendere più di quanto è stato venduto: il totale già reso è
--     ricalcolato dal registro a ogni chiamata, sotto il lock della catena.

-- ---------------------------------------------------------------------------
-- 0) Il totale reso, sull'ordine
-- ---------------------------------------------------------------------------
-- Ridondante rispetto al registro (che resta la verità) ma la UI non deve
-- percorrere una catena di hash per stampare un badge "reso 8,00 €".
alter table public.cassa_orders
  add column if not exists refunded_total numeric not null default 0;

-- ---------------------------------------------------------------------------
-- 1) Quanto è già stato reso su questo scontrino
-- ---------------------------------------------------------------------------
-- Somma degli importi (negativi) delle rettificative già in catena per l'ordine.
-- Ritorna un valore POSITIVO: "di questo scontrino sono già stati resi X €".
-- Legge dal registro, non da un contatore a parte: un contatore può divergere,
-- il registro no — è la definizione stessa di ciò che è successo.
create or replace function public.fn_fiscal_refunded_total(
  p_tenant_id uuid,
  p_order_id uuid
) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(-sum(importe_total), 0)::numeric
    from public.fiscal_records
   where tenant_id = p_tenant_id
     and cassa_order_id = p_order_id
     and tipo = 'alta'
     and tipo_factura = 'R5';
$$;

-- ---------------------------------------------------------------------------
-- 2) fn_cassa_rectify_atomic — il reso parziale, tutto in una transazione
-- ---------------------------------------------------------------------------
-- p_desglose / p_cuota_total / p_importe_total arrivano NEGATIVI dall'app (è la
-- matematica dei soldi, che resta in TypeScript — vedi src/lib/cassa/totals.ts —
-- e che qui viene solo VERIFICATA, mai ricalcolata).
--
-- Il numero: la rettificativa consuma un numero dalla STESSA serie degli scontrini
-- (cassa_counters). Non una numerazione separata — la catena è una sola, e un
-- documento fiscale che non ha un numero della serie non esiste per AEAT.
create or replace function public.fn_cassa_rectify_atomic(
  p_tenant_id uuid,
  p_order_id uuid,
  p_reason text,
  p_rectified_by uuid,
  p_business_date date,
  p_year integer,
  p_closed_at timestamptz,
  -- il delta, NEGATIVO
  p_net_total numeric,
  p_cuota_total numeric,
  p_importe_total numeric,
  p_desglose jsonb,
  -- fiscal (ES) — false/null in Italia, dove ci si ferma al passo 4
  p_fiscal boolean default false,
  p_obligado_id uuid default null,
  p_serie text default '',
  p_fecha_hora_huso text default null,
  p_sistema jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order public.cassa_orders%rowtype;
  v_sale public.pos_sales%rowtype;
  v_orig_num text;
  v_num_serie text;
  v_no integer;
  v_record_id uuid := null;
  v_huella text := null;
  v_refunded numeric;
  v_amount numeric;
begin
  -- Il reso ha senso su un incasso avvenuto e non annullato. Uno scontrino `void`
  -- è già stato azzerato per intero: rettificarlo significherebbe rendere denaro
  -- che è già stato reso.
  select * into v_order
    from public.cassa_orders
   where id = p_order_id and tenant_id = p_tenant_id and status = 'paid'
   for update;

  if v_order.id is null then
    return jsonb_build_object('rectified', false, 'reason', 'order_not_paid');
  end if;

  -- L'importo del reso, come numero positivo.
  v_amount := -round(coalesce(p_importe_total, 0), 2);
  if v_amount <= 0 then
    raise exception 'fiscal: una rettificativa deve avere importo negativo (ricevuto %)', p_importe_total;
  end if;

  -- Non si rende più di quanto incassato. Il già-reso è letto dal registro, e
  -- questa riga gira DENTRO la transazione che ha appena preso `for update`
  -- sull'ordine: due cassieri che rendono lo stesso piatto nello stesso istante
  -- non possono superare il totale in due mosse concorrenti.
  v_refunded := public.fn_fiscal_refunded_total(p_tenant_id, p_order_id);
  if round(v_refunded + v_amount, 2) > round(v_order.total, 2) then
    raise exception 'fiscal: reso % € oltre il residuo (scontrino % €, già reso % €)',
      v_amount, v_order.total, v_refunded;
  end if;

  -- La vendita canonica originale (assente su ordini molto vecchi).
  select * into v_sale
    from public.pos_sales
   where tenant_id = p_tenant_id and provider = 'cassa' and external_id = p_order_id::text
   order by created_at
   limit 1;

  v_orig_num := coalesce(v_sale.raw_payload->>'num_serie', '');
  if v_orig_num = '' then
    v_orig_num := coalesce(v_order.receipt_year::text, '') || '/' ||
                  lpad(coalesce(v_order.receipt_number, 0)::text, 6, '0');
  end if;

  -- Un numero NUOVO, dalla stessa serie: la rettificativa è un documento a sé.
  insert into public.cassa_counters (tenant_id, year, last_number)
  values (p_tenant_id, p_year, 1)
  on conflict (tenant_id, year)
  do update set last_number = cassa_counters.last_number + 1
  returning last_number into v_no;

  v_num_serie := coalesce(p_serie,'') || p_year::text || '/' || lpad(v_no::text, 6, '0');

  -- La riga compensativa: stessa forma, segno opposto. Il P&L torna da solo
  -- (la coppia somma al netto reale) e non si perde nulla.
  insert into public.pos_sales (
    tenant_id, provider, external_id, channel, business_date, closed_at, currency,
    gross_total, net_total, tax_total, discount_total, covers, payment_method,
    order_ref, raw_payload
  ) values (
    p_tenant_id, 'cassa', p_order_id::text || ':rect:' || v_no::text,
    coalesce(v_sale.channel, 'sala'), p_business_date, p_closed_at, 'EUR',
    round(coalesce(p_importe_total,0), 2),
    round(coalesce(p_net_total,0), 2),
    round(coalesce(p_cuota_total,0), 2),
    0, null, coalesce(v_sale.payment_method, 'cash'),
    'rettifica ' || v_orig_num,
    jsonb_build_object(
      'source', 'cassa_nativa',
      'rectifies', p_order_id,
      'rectifies_num_serie', v_orig_num,
      'num_serie', v_num_serie,
      'reason', p_reason,
      'desglose', coalesce(p_desglose, '[]'::jsonb)
    )
  );

  -- Spagna: la rettificativa entra in catena come `alta` di tipo R5, con il
  -- puntatore all'originale. In Italia ci si ferma qui — la riga compensativa
  -- sopra è già tutto ciò che serve, ed è comunque una correzione tracciata.
  if p_fiscal then
    if p_obligado_id is null or p_fecha_hora_huso is null then
      raise exception 'fiscal: obligado_id e fecha_hora_huso sono richiesti quando p_fiscal è true';
    end if;

    v_record_id := public.fn_fiscal_append(
      p_obligado_id, p_tenant_id, 'alta', v_num_serie, p_business_date, 'R5',
      p_desglose, p_cuota_total, p_importe_total, p_fecha_hora_huso, p_sistema, p_order_id,
      -- `rectifica`: chi sto rettificando, e come. `por_diferencias` è ciò che i
      -- numeri negativi qui sopra SONO — dichiararlo `por_sustitucion` mentre si
      -- inviano dei delta farebbe archiviare ad AEAT un totale sbagliato.
      jsonb_build_object(
        'tipo', 'por_diferencias',
        'num_serie', v_orig_num,
        'fecha_expedicion', coalesce(v_order.receipt_date, p_business_date),
        'motivo', p_reason
      )
    );
    select huella into v_huella from public.fiscal_records where id = v_record_id;
  end if;

  -- Traccia sull'ordine: quanto è stato reso in tutto, così la UI lo mostra senza
  -- dover interrogare la catena a ogni render.
  update public.cassa_orders
     set refunded_total = round(v_refunded + v_amount, 2),
         updated_at = now()
   where id = p_order_id;

  return jsonb_build_object(
    'rectified', true,
    'num_serie', v_num_serie,
    'receipt_number', v_no,
    'rectifies_num_serie', v_orig_num,
    'refunded_total', round(v_refunded + v_amount, 2),
    'fiscal_record_id', v_record_id,
    'huella', v_huella
  );
end $$;

-- ============================================================================
-- PAY-AT-TABLE (QR) — folded from scripts/migrations/2026-07-16-table-qr-pay.sql
-- ============================================================================
-- Pay-at-table via the table QR (2026-07-16).
--
-- The guest scans the SAME QR already on the table (/m/<slug>?table=<id>),
-- opens their bill and pays it with Stripe Checkout. The money goes to the
-- TENANT'S OWN Stripe account: the key lives encrypted in payment_secrets
-- (provider 'stripe', BYO-key pattern identical to the tenant Resend key) —
-- there is no platform fallback, no key = no QR payments for that tenant.
--
-- cassa_qr_payments maps each Stripe Checkout Session to the cassa order it
-- pays. The amount is frozen at checkout-creation time; the confirm step
-- (called by the guest's phone on return from Stripe) re-verifies the session
-- against Stripe with the tenant key, compares the amount with the CURRENT
-- server-side total, and only then settles the order through the same atomic
-- fiscal path as the till (method 'online'). unique(stripe_session_id) makes
-- the confirm idempotent under double-taps and webhookless retries.
--
-- status:
--   pending          checkout created, guest is on the Stripe page
--   settled          verified paid + order closed with a receipt
--   amount_mismatch  guest paid, but the bill changed meanwhile → staff settles
--                    by hand (critical system_log raised)
--   failed           verified-paid money on a bill no longer open (e.g. staff
--                    charged it at the till meanwhile) → possible double charge,
--                    staff refunds from Stripe (critical system_log raised)

create table if not exists public.cassa_qr_payments (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid references public.cassa_orders(id) on delete set null,
  table_id uuid,
  table_name text not null default '',
  stripe_session_id text not null,
  amount_cents integer not null,
  currency text not null default 'eur',
  status text not null default 'pending'
    check (status in ('pending','settled','amount_mismatch','failed')),
  receipt_number integer,
  receipt_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_cassa_qr_payments_session unique (stripe_session_id)
);

create index if not exists idx_cassa_qr_payments_tenant
  on public.cassa_qr_payments (tenant_id, created_at desc);
create index if not exists idx_cassa_qr_payments_order
  on public.cassa_qr_payments (order_id);

alter table public.cassa_qr_payments enable row level security;

-- Members see their venue's QR payments (read-only); all writes go through the
-- service-role public routes. Same posture as cassa_payments.
create policy "cassa_qr_payments tenant read" on public.cassa_qr_payments
  for select using (private.is_tenant_member(tenant_id));
create policy "cassa_qr_payments admin access" on public.cassa_qr_payments
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
