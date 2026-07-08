-- ============================================================================
-- STAFF SHIFTS (turni) + SHIFT REQUESTS (ferie / cambio turno) — 2026-07-08
-- ============================================================================
-- Weekly rota for the venue's team (tenant_members). Deliberately NOT an HR
-- system: no wages here (labor_cost stays the aggregate money source for P&L).
--
--   • staff_shifts: one row per member per assignment (date + band + times).
--     Cancelled shifts keep their row (status) so an approved time-off leaves
--     a trace instead of silently deleting history.
--   • shift_requests: a member asks for time off, or to hand a shift to a
--     colleague (swap). Owner/manager approve/reject; approval side-effects
--     (cancelling / reassigning the shift) run in the API route.
--   • RLS: every member READS the whole rota (that's how a posted rota works);
--     only owner/manager write shifts and decide requests; a member can only
--     create requests for THEMSELVES. All API writes run service-role anyway —
--     these policies are the browser-side floor.
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

create table if not exists public.staff_shifts (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.tenant_members(id) on delete cascade,
  work_date date not null,
  band text not null default 'dinner' check (band in ('lunch','dinner','all')),
  start_time time not null,
  end_time time not null,             -- end <= start means the shift crosses midnight
  role_note text,                     -- free label: "sala", "bar", "passe"…
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_shifts_tenant_date
  on public.staff_shifts (tenant_id, work_date);
create index if not exists idx_staff_shifts_member
  on public.staff_shifts (member_id, work_date);

create table if not exists public.shift_requests (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.tenant_members(id) on delete cascade,
  type text not null check (type in ('time_off','swap')),
  work_date date not null,
  -- swap: the requester's shift to hand over, and the colleague taking it.
  target_shift_id uuid references public.staff_shifts(id) on delete set null,
  target_member_id uuid references public.tenant_members(id) on delete set null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_shift_requests_tenant
  on public.shift_requests (tenant_id, status, created_at desc);

alter table public.staff_shifts enable row level security;
alter table public.shift_requests enable row level security;

-- Rota: readable by the whole team, writable by owner/manager.
drop policy if exists "staff_shifts member read" on public.staff_shifts;
create policy "staff_shifts member read" on public.staff_shifts
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

drop policy if exists "staff_shifts manager write" on public.staff_shifts;
create policy "staff_shifts manager write" on public.staff_shifts
  for all using (private.get_tenant_role(tenant_id) in ('owner','manager') or private.is_platform_admin());

-- Requests: whole team reads (a swap involves a colleague), a member inserts
-- only for their own membership row, owner/manager update (decide).
drop policy if exists "shift_requests member read" on public.shift_requests;
create policy "shift_requests member read" on public.shift_requests
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

drop policy if exists "shift_requests own insert" on public.shift_requests;
create policy "shift_requests own insert" on public.shift_requests
  for insert with check (
    private.is_tenant_member(tenant_id)
    and member_id in (select id from public.tenant_members where tenant_id = shift_requests.tenant_id and user_id = auth.uid())
  );

drop policy if exists "shift_requests manager update" on public.shift_requests;
create policy "shift_requests manager update" on public.shift_requests
  for update using (private.get_tenant_role(tenant_id) in ('owner','manager') or private.is_platform_admin());
