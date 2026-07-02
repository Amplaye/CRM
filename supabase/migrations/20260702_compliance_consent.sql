-- ============================================================================
-- COMPLIANCE — consent records (GDPR Art. 7 / revFADP accountability log)
-- ----------------------------------------------------------------------------
-- The server-side, invisible-to-the-user record that proves we captured explicit
-- consent before processing SENSITIVE (Tier 1) personal data — allergies/health,
-- accessibility needs. One row per consent event, written when the just-in-time
-- micro-consent is granted (see src/lib/compliance/consent.ts). This is the
-- accountability evidence a regulator (or a DSAR) can ask for.
--
-- It is deliberately a THIN, append-only ledger: no PII beyond a subject reference
-- (phone/email/guest id) + the affirmative text; the sensitive value itself stays
-- in the guests row (dietary_notes/accessibility_notes) under the same tenant RLS.
--
-- Written by the bot/API via service_role (which BYPASSES RLS). Read by tenant
-- staff (their own tenant only) and platform admins (support + DSAR). MANUAL to
-- apply, like every migration here.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.consent_records (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- How we identify the data subject at consent time: a phone number, email, or the
  -- guest UUID as text. Stored normalized (lowercased/trimmed) by the lib.
  subject_ref text not null,
  -- Optional hard link to the guest row once one exists (nulled, not deleted, if the
  -- guest is later erased — the accountability record must survive erasure).
  guest_id uuid references public.guests(id) on delete set null,
  -- What the consent is FOR, e.g. 'store_allergy_for_kitchen'. Free text, lib-validated.
  purpose text not null,
  -- Which data category the consent covers. Mirrors the classifier's categories plus
  -- 'ordinary' for the rare case we log an ordinary-data consent.
  data_category text not null default 'health'
    check (data_category in ('health', 'accessibility', 'ordinary')),
  -- Where the consent was given.
  channel text not null default 'whatsapp'
    check (channel in ('whatsapp', 'voice', 'web', 'staff')),
  -- true = consent granted; false = explicitly declined/withdrawn (kept for the trail).
  granted boolean not null default true,
  -- The privacy-policy version in force when consent was captured.
  policy_version text not null default 'v1',
  -- The actual affirmative the subject sent ("sì, salva pure") — the raw evidence.
  evidence text,
  created_at timestamptz not null default now()
);

alter table public.consent_records enable row level security;

create index if not exists idx_consent_records_lookup
  on public.consent_records (tenant_id, subject_ref, purpose, created_at desc);
create index if not exists idx_consent_records_guest
  on public.consent_records (guest_id) where guest_id is not null;

-- Tenant staff can read their own tenant's consent trail; platform admins read all.
drop policy if exists "Members read own consent records" on public.consent_records;
create policy "Members read own consent records" on public.consent_records
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- Writes come from service_role (the bot/API), which BYPASSES RLS. Platform admins
-- may also write (manual correction/support). No client-side insert path.
drop policy if exists "Admins write consent records" on public.consent_records;
create policy "Admins write consent records" on public.consent_records
  for insert with check (private.is_platform_admin());

-- Rollback (manual):
--   drop table if exists public.consent_records;
