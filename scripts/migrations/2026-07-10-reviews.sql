-- ============================================================================
-- CERTIFIED REVIEWS — 2026-07-10
-- ============================================================================
-- In-house review collection (Fase 2 of the all-inclusive plan). A guest who
-- actually had a reservation gets a SIGNED link (/rv/<token>) in the post-visit
-- follow-up; the form saves rating+comment here, then bounces them to the
-- tenant's public Google review page. "Certified" = one review per
-- reservation, only via the signed link — the public can't submit.
--
--   • unique(reservation_id): re-submitting the form updates, never duplicates.
--   • Writes go through the service role only (/api/reviews/submit verifies
--     the HMAC token; /api/reviews/reply verifies membership) — members read
--     and never insert directly.
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

create table if not exists public.reviews (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reservation_id uuid not null unique references public.reservations(id) on delete cascade,
  guest_id uuid references public.guests(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  comment text not null default '',
  -- 'guest' = signed-link form. Room for future sources (google import, staff).
  source text not null default 'guest' check (source in ('guest','staff','import')),
  status text not null default 'new' check (status in ('new','replied','hidden')),
  reply text,
  reply_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reviews_tenant on public.reviews (tenant_id, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists "reviews member read" on public.reviews;
create policy "reviews member read" on public.reviews
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());

-- Reply/hide from the dashboard goes through /api/reviews/reply (service
-- role) — but allow owner/manager row updates too so future UI can write
-- directly under RLS if it wants.
drop policy if exists "reviews manager update" on public.reviews;
create policy "reviews manager update" on public.reviews
  for update using (
    private.get_tenant_role(tenant_id) in ('owner','manager') or private.is_platform_admin()
  );
