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
  business_type text not null default 'restaurant' check (business_type in ('restaurant', 'ecommerce', 'services', 'other')),
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
  linked_conversation_id uuid,
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
-- 11. AUTOMATION RULES
-- ============================================
create table public.automation_rules (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text not null default '',
  trigger text not null check (trigger in ('on_reservation_created', 'on_reservation_cancelled', 'on_waitlist_match', 'on_ai_escalation', 'schedule')),
  condition jsonb,
  action jsonb not null default '{"type": "notify_staff", "payload": {}}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
create index idx_guests_tenant on public.guests(tenant_id);
create index idx_reservations_tenant on public.reservations(tenant_id);
create index idx_reservations_date on public.reservations(tenant_id, date);
create index idx_reservations_guest on public.reservations(guest_id);
create index idx_reservation_events_reservation on public.reservation_events(reservation_id);
create index idx_waitlist_tenant on public.waitlist_entries(tenant_id);
create index idx_conversations_tenant on public.conversations(tenant_id);
create index idx_incidents_tenant on public.incidents(tenant_id);
create index idx_knowledge_tenant on public.knowledge_articles(tenant_id);
create index idx_automations_tenant on public.automation_rules(tenant_id);
create index idx_audit_events_tenant on public.audit_events(tenant_id);
create index idx_audit_events_idempotency on public.audit_events(idempotency_key);

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
alter table public.automation_rules enable row level security;
alter table public.audit_events enable row level security;

-- Helper: check if user is member of a tenant
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- Helper: check if user is platform admin
create or replace function public.is_platform_admin()
returns boolean as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and global_role = 'platform_admin'
  );
$$ language sql security definer stable;

-- Helper: get user's role in a tenant
create or replace function public.get_tenant_role(p_tenant_id uuid)
returns text as $$
  select role from public.tenant_members
  where tenant_id = p_tenant_id and user_id = auth.uid()
  limit 1;
$$ language sql security definer stable;

-- USERS policies
create policy "Users can read own profile" on public.users for select using (id = auth.uid() or public.is_platform_admin());
create policy "Users can update own profile" on public.users for update using (id = auth.uid());
create policy "Users can insert own profile" on public.users for insert with check (id = auth.uid());

-- TENANTS policies
create policy "Tenant members can read tenants" on public.tenants for select using (public.is_tenant_member(id) or public.is_platform_admin());
create policy "Owners/managers can update tenant" on public.tenants for update using (public.get_tenant_role(id) in ('owner', 'manager') or public.is_platform_admin());
create policy "Platform admins can create tenants" on public.tenants for insert with check (public.is_platform_admin());
create policy "Platform admins can delete tenants" on public.tenants for delete using (public.is_platform_admin());

-- TENANT MEMBERS policies
create policy "Members can read own memberships" on public.tenant_members for select using (user_id = auth.uid() or public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy "Owners/managers can manage members" on public.tenant_members for insert with check (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());
create policy "Owners/managers can update members" on public.tenant_members for update using (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());
create policy "Owners/managers can remove members" on public.tenant_members for delete using (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());

-- GUESTS policies
create policy "Tenant members can read guests" on public.guests for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy "Staff can manage guests" on public.guests for insert with check (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());
create policy "Staff can update guests" on public.guests for update using (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());
create policy "Managers can delete guests" on public.guests for delete using (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());

-- RESERVATIONS policies
create policy "Tenant members can read reservations" on public.reservations for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy "Staff can create reservations" on public.reservations for insert with check (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());
create policy "Staff can update reservations" on public.reservations for update using (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());
create policy "Managers can delete reservations" on public.reservations for delete using (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());

-- RESERVATION EVENTS policies (read-only for clients, server writes via service_role)
create policy "Tenant members can read events" on public.reservation_events for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

-- WAITLIST policies
create policy "Tenant members can read waitlist" on public.waitlist_entries for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy "Staff can manage waitlist" on public.waitlist_entries for insert with check (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());
create policy "Staff can update waitlist" on public.waitlist_entries for update using (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());
create policy "Staff can delete waitlist" on public.waitlist_entries for delete using (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());

-- CONVERSATIONS policies
create policy "Tenant members can read conversations" on public.conversations for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy "Staff can manage conversations" on public.conversations for insert with check (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());
create policy "Staff can update conversations" on public.conversations for update using (public.get_tenant_role(tenant_id) in ('owner', 'manager', 'host') or public.is_platform_admin());

-- INCIDENTS policies
create policy "Tenant members can read incidents" on public.incidents for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy "Managers can manage incidents" on public.incidents for insert with check (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());
create policy "Managers can update incidents" on public.incidents for update using (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());

-- KNOWLEDGE ARTICLES policies
create policy "Tenant members can read articles" on public.knowledge_articles for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy "Managers can manage articles" on public.knowledge_articles for insert with check (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());
create policy "Managers can update articles" on public.knowledge_articles for update using (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());

-- AUTOMATION RULES policies
create policy "Tenant members can read automations" on public.automation_rules for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy "Managers can manage automations" on public.automation_rules for insert with check (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());
create policy "Managers can update automations" on public.automation_rules for update using (public.get_tenant_role(tenant_id) in ('owner', 'manager') or public.is_platform_admin());

-- AUDIT EVENTS policies (read-only for clients)
create policy "Tenant members can read audit events" on public.audit_events for select using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

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
