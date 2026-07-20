-- ---------------------------------------------------------------------------
-- Product announcements — "we shipped something new, come and see it".
--
-- One platform-wide announcement at a time, rendered as a centred modal the
-- first time an eligible user lands on the dashboard, then never again for
-- that user. This is NOT tenant-scoped: an announcement is written once by a
-- platform admin and reaches every tenant. Targeting is done by AUDIENCE
-- (owner/manager vs everyone), never by a per-tenant list — the CRM has no
-- "branches per tenant" and this stays true to that.
--
-- Copy lives in jsonb {it,en,es,de} rather than four columns, and rather than
-- the i18n dictionaries: an announcement is *content*, published from the
-- admin UI without a deploy, so it cannot live in a TS file. Same L10n shape
-- as the assistant KB (src/lib/assistant/kb.ts).
--
-- Writes go through /api/admin/announcements with the service-role client
-- (RLS bypassed); the policies below are the browser-side floor only.
-- ---------------------------------------------------------------------------

create table if not exists public.announcements (
  id uuid default gen_random_uuid() primary key,
  slug text not null unique,                       -- stable id, e.g. 'social-2026-07'
  title jsonb not null default '{}'::jsonb,        -- {"it":"…","en":"…","es":"…","de":"…"}
  body jsonb not null default '{}'::jsonb,
  cta_label jsonb not null default '{}'::jsonb,    -- empty → the UI falls back to a generic label
  cta_href text,                                   -- in-app path, e.g. '/social'. null → no button
  audience text not null default 'owner_manager'
    check (audience in ('owner_manager', 'all')),
  published boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,                             -- null → no expiry
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The read path is always "the newest live one", so index the live predicate.
create index if not exists idx_announcements_live
  on public.announcements (published, starts_at desc);

-- announcement_dismissals — one row per (announcement, user). Its presence IS
-- the "already seen" flag; `clicked` records whether they took the CTA, which
-- is the only reach metric we keep.
--
-- tenant_id is nullable on purpose: a platform admin browsing without an active
-- tenant can still dismiss, and we don't want that write to fail.
create table if not exists public.announcement_dismissals (
  id uuid default gen_random_uuid() primary key,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  clicked boolean not null default false,
  dismissed_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

create index if not exists idx_announcement_dismissals_user
  on public.announcement_dismissals (user_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.announcements enable row level security;
alter table public.announcement_dismissals enable row level security;

-- Anyone signed in may read a PUBLISHED announcement (it is marketing copy
-- meant for every tenant). Drafts stay invisible until published.
drop policy if exists "announcements published read" on public.announcements;
create policy "announcements published read" on public.announcements
  for select using (published or private.is_platform_admin());

drop policy if exists "announcements admin write" on public.announcements;
create policy "announcements admin write" on public.announcements
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- A user reads and writes only their own dismissals.
drop policy if exists "announcement_dismissals own read" on public.announcement_dismissals;
create policy "announcement_dismissals own read" on public.announcement_dismissals
  for select using (user_id = (select auth.uid()) or private.is_platform_admin());

drop policy if exists "announcement_dismissals own insert" on public.announcement_dismissals;
create policy "announcement_dismissals own insert" on public.announcement_dismissals
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "announcement_dismissals own update" on public.announcement_dismissals;
create policy "announcement_dismissals own update" on public.announcement_dismissals
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "announcement_dismissals admin write" on public.announcement_dismissals;
create policy "announcement_dismissals admin write" on public.announcement_dismissals
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
