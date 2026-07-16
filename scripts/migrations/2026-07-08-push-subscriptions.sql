-- ============================================================================
-- WEB PUSH SUBSCRIPTIONS — 2026-07-08
-- ============================================================================
-- One row per (user, browser/device) Web-Push subscription. The dashboard PWA
-- subscribes via /api/push/subscribe; server events (new booking, waitlist,
-- WhatsApp message) fan out to every subscription of the tenant via
-- src/lib/push/send.ts (web-push + VAPID keys in Vercel env).
--
--   • endpoint is globally unique (it identifies the browser subscription);
--     re-subscribing upserts the same row to the current user/tenant.
--   • Users manage their own rows (RLS below); the send path runs service-role
--     and deletes rows the push service reports gone (404/410).
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  -- {"p256dh": "...", "auth": "..."} straight from PushSubscription.toJSON().keys
  keys jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_tenant
  on public.push_subscriptions (tenant_id);
create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Each user sees/manages only their own subscriptions (any tenant they're in).
drop policy if exists "push_subscriptions own read" on public.push_subscriptions;
create policy "push_subscriptions own read" on public.push_subscriptions
  for select using (user_id = auth.uid() or private.is_platform_admin());

drop policy if exists "push_subscriptions own insert" on public.push_subscriptions;
create policy "push_subscriptions own insert" on public.push_subscriptions
  for insert with check (user_id = auth.uid() and private.is_tenant_member(tenant_id));

drop policy if exists "push_subscriptions own update" on public.push_subscriptions;
create policy "push_subscriptions own update" on public.push_subscriptions
  for update using (user_id = auth.uid());

drop policy if exists "push_subscriptions own delete" on public.push_subscriptions;
create policy "push_subscriptions own delete" on public.push_subscriptions
  for delete using (user_id = auth.uid() or private.is_platform_admin());
