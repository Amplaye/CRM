-- ============================================================================
-- MARKETING CAMPAIGNS — 2026-07-10
-- ============================================================================
-- Segment-targeted campaigns (Fase 3 of the all-inclusive plan): email via
-- Resend, WhatsApp via approved MARKETING template. The segment is stored as
-- DATA (jsonb SegmentDef — see src/lib/guests/segmentation.ts) and re-evaluated
-- at send time. campaign_recipients is the idempotency ledger: one row per
-- (campaign, guest), so a retried send never double-messages anyone.
--
--   • guests gains birthday (fuels the birthday segment) and
--     marketing_opt_out (compliance: excluded from every campaign; set by the
--     public /u/<token> unsubscribe page).
--   • Writes are service-role only (the send route verifies membership).
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

alter table public.guests
  add column if not exists birthday date,
  add column if not exists marketing_opt_out boolean not null default false;

create table if not exists public.campaigns (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('email','whatsapp','sms')),
  -- SegmentDef jsonb, e.g. {"kind":"lapsed","days":90}
  segment jsonb not null default '{"kind":"all"}'::jsonb,
  subject text,          -- email only
  body text not null default '',
  status text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  scheduled_at timestamptz,
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_campaigns_tenant on public.campaigns (tenant_id, created_at desc);

create table if not exists public.campaign_recipients (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, guest_id)
);

create index if not exists idx_campaign_recipients_campaign
  on public.campaign_recipients (campaign_id);

alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;

drop policy if exists "campaigns member read" on public.campaigns;
create policy "campaigns member read" on public.campaigns
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

drop policy if exists "campaign_recipients member read" on public.campaign_recipients;
create policy "campaign_recipients member read" on public.campaign_recipients
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
