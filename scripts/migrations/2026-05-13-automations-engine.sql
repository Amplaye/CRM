-- ============================================
-- Migration: Automations engine support
-- Date: 2026-05-13
-- Run once in Supabase SQL editor.
-- ============================================

-- 1. Add tracking columns to automation_rules
alter table public.automation_rules add column if not exists last_run_at timestamptz;
alter table public.automation_rules add column if not exists run_count integer not null default 0;

-- 2. Create automation_runs log table
create table if not exists public.automation_runs (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  trigger text not null,
  context jsonb not null default '{}'::jsonb,
  status text not null check (status in ('success', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now()
);

-- 3. Indexes
create index if not exists idx_automations_trigger_active
  on public.automation_rules(tenant_id, trigger) where is_active = true;
create index if not exists idx_automation_runs_rule
  on public.automation_runs(rule_id, created_at desc);
create index if not exists idx_automation_runs_tenant
  on public.automation_runs(tenant_id, created_at desc);

-- 4. RLS
alter table public.automation_runs enable row level security;

drop policy if exists "Tenant members can read automation runs" on public.automation_runs;
create policy "Tenant members can read automation runs"
  on public.automation_runs for select
  using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- 5. Allow managers to delete automation_rules (previously missing)
drop policy if exists "Managers can delete automations" on public.automation_rules;
create policy "Managers can delete automations"
  on public.automation_rules for delete
  using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());

-- 6. Add 'automation' to system_logs.category check constraint
alter table public.system_logs drop constraint if exists system_logs_category_check;
alter table public.system_logs add constraint system_logs_category_check
  check (category in ('booking_error','webhook_failure','message_failure','api_error','ai_error','automation','system','n8n_error','health_check','silent_warning'));

-- 7. Remove obsolete English seed presets so the page starts clean
delete from public.automation_rules
where name in (
  'Booking Confirmation via WhatsApp',
  'Waitlist Auto-Matching Engine',
  'High-Risk No-Show Escalator'
);
