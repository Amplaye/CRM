-- Labor cost from shifts. Lets the planned rota (staff_shifts) be costed
-- automatically and written into labor_cost — which the P&L already reads. Until
-- now labor_cost was filled by hand (and so, in practice, never), leaving the
-- P&L's labor line empty.
--
-- Wages are sensitive: tenant_members is readable by EVERY member (its SELECT
-- RLS is is_tenant_member), so a per-member wage must NOT live there or a waiter
-- could read every colleague's pay. It goes in a dedicated staff_pay table whose
-- RLS is owner/manager-only. The staff module stays "not an HR system": one
-- optional number per member, nothing else.
--
-- `source` on labor_cost lets the recompute own the rows it writes ('shifts')
-- without clobbering figures typed by hand ('manual').
--
-- Idempotent: safe to re-paste into the Supabase SQL editor.

-- An earlier revision briefly put the rate on tenant_members; undo that so wages
-- never sit on a table the whole team can read.
alter table public.tenant_members drop column if exists hourly_rate;

create table if not exists public.staff_pay (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  member_id   uuid not null references public.tenant_members(id) on delete cascade,
  hourly_rate numeric(8,2),                 -- paga oraria lorda, null = non impostata
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, member_id)
);

alter table public.staff_pay enable row level security;

-- Owner/manager only — never the whole team.
drop policy if exists "staff_pay owner manager" on public.staff_pay;
create policy "staff_pay owner manager" on public.staff_pay
  for all
  using (private.get_tenant_role(tenant_id) in ('owner','manager') or private.is_platform_admin())
  with check (private.get_tenant_role(tenant_id) in ('owner','manager') or private.is_platform_admin());

alter table public.labor_cost
  add column if not exists source text not null default 'manual'
    check (source in ('manual','shifts'));
