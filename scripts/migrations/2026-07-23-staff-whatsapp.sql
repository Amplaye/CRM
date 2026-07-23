-- Verified staff WhatsApp numbers — the identity gate for the manager agent.
-- The bot answers stock/takings questions and books invoices from a photo; that
-- agent must only ever talk to a real staff member, and a WhatsApp sender is
-- trivially spoofable, so a number is trusted only after a code round-trip:
--   1. dashboard (owner/manager) generates a one-time code and shows it;
--   2. the person sends that code from their phone to the restaurant's number;
--   3. the bot matches it and stamps this row verified with the sender's number.
-- Verifying by INBOUND code (not an outbound SMS/WhatsApp) sidesteps Meta's 24h
-- outbound-to-unknown-number rule entirely.
--
-- Wages-grade sensitivity (this agent knows the takings), so RLS is owner/manager
-- only; the bot reads/writes it with the service role.
--
-- Idempotent: safe to re-paste into the Supabase SQL editor.

create table if not exists public.staff_whatsapp (
  id           uuid default uuid_generate_v4() primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  member_id    uuid references public.tenant_members(id) on delete cascade,
  phone        text,                         -- E.164, filled on successful verify
  verify_code  text,                         -- pending one-time code (cleared on verify)
  code_expires_at timestamptz,
  verified_at  timestamptz,                  -- null = pending
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One verified number can map to one tenant membership; a phone is unique per
-- tenant once verified. (Pending rows may share a null phone.)
create unique index if not exists uq_staff_whatsapp_phone
  on public.staff_whatsapp(tenant_id, phone) where phone is not null;
create index if not exists idx_staff_whatsapp_tenant_verified
  on public.staff_whatsapp(tenant_id) where verified_at is not null;

alter table public.staff_whatsapp enable row level security;

drop policy if exists "staff_whatsapp owner manager" on public.staff_whatsapp;
create policy "staff_whatsapp owner manager" on public.staff_whatsapp
  for all
  using (private.get_tenant_role(tenant_id) in ('owner','manager') or private.is_platform_admin())
  with check (private.get_tenant_role(tenant_id) in ('owner','manager') or private.is_platform_admin());
