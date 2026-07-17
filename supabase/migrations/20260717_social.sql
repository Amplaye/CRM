-- ---------------------------------------------------------------------------
-- Social section — Instagram + Facebook publishing (Meta Graph API).
--
-- Two tenant-scoped tables, same security shape as credits / billing / the
-- WhatsApp embedded-signup connection: MEMBERS READ their tenant's rows, only
-- platform admins (and the service-role used by API routes + the cron, which
-- bypasses RLS) WRITE. Mirrors 20260625_whatsapp_embedded_signup.sql and
-- 20260713_credits.sql.
--
-- SECRET TOKEN: the long-lived Page access token is NOT stored here — it goes
-- in tenants.secrets (service-role-only), exactly like meta_access_token for
-- WhatsApp (see storeMetaConnection). This table holds only member-readable
-- identifiers + status, so the browser can render "Connected as @venue" without
-- ever seeing the token. `ig_user_id` / `page_id` are public identifiers, safe
-- to expose to members.
-- ---------------------------------------------------------------------------

-- social_accounts — one connected social identity per tenant/platform.
create table if not exists public.social_accounts (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  account_name text,
  ig_user_id text,           -- Instagram Business account id (publish target for IG)
  page_id text,              -- Facebook Page id (publish target for FB, and the IG link)
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'revoked')),
  last_error text,
  updated_at timestamptz not null default now(),
  unique (tenant_id, platform)
);
create index if not exists idx_social_accounts_tenant on public.social_accounts(tenant_id);

-- social_posts — the editorial / approval queue. A post is born 'draft', the
-- owner approves it ('approved' + scheduled_at), and the hourly cron transitions
-- it publishing -> published (or -> failed). Members never write 'published'
-- directly; that transition only happens through the service-role cron.
create table if not exists public.social_posts (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'canceled')),
  media_type text not null check (media_type in ('image', 'carousel', 'reels')),
  caption text not null default '',
  media_urls jsonb not null default '[]'::jsonb,   -- public URLs in the social-media bucket
  targets jsonb not null default '[]'::jsonb,       -- ['instagram','facebook']
  scheduled_at timestamptz,
  published_at timestamptz,
  ig_media_id text,
  fb_post_id text,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_social_posts_tenant on public.social_posts(tenant_id);
-- The cron scans by (status, scheduled_at): due posts waiting to publish.
create index if not exists idx_social_posts_due on public.social_posts(status, scheduled_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;

create policy "social_accounts tenant read" on public.social_accounts
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "social_accounts admin write" on public.social_accounts
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- Members READ the queue and, so the composer/queue UI can work offline of the
-- cron, may create/update/delete their OWN tenant's DRAFT-side rows. The
-- 'published'/'publishing' transitions are done by the service-role cron (which
-- bypasses RLS), so there is no way for a member to mark a post published.
create policy "social_posts tenant read" on public.social_posts
  for select using (private.is_tenant_member(tenant_id) or private.is_platform_admin());
create policy "social_posts tenant insert" on public.social_posts
  for insert with check (private.is_tenant_member(tenant_id) and status in ('draft', 'approved', 'scheduled', 'canceled'));
create policy "social_posts tenant update" on public.social_posts
  for update using (private.is_tenant_member(tenant_id))
  with check (private.is_tenant_member(tenant_id) and status in ('draft', 'approved', 'scheduled', 'canceled'));
create policy "social_posts tenant delete" on public.social_posts
  for delete using (private.is_tenant_member(tenant_id));
create policy "social_posts admin write" on public.social_posts
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Realtime — the approval queue updates live when the cron publishes a post.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'social_posts'
  ) then
    alter publication supabase_realtime add table public.social_posts;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage bucket `social-media` (PUBLIC) — Meta's servers cURL image_url /
-- video_url when publishing, so the rendered media must be publicly reachable.
-- Mirrors the menu-images bucket (public read, authenticated write). Path
-- convention: `${tenant_id}/${uuid}.{jpg|mp4}`. The signed-upload route uses the
-- service-role client (bypasses RLS), so the auth policies below only matter for
-- any future direct client writes; the public-read policy is what lets Meta fetch.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', true, 62914560, array['image/jpeg','image/png','video/mp4'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='social_media_public_read') then
    create policy "social_media_public_read" on storage.objects
      for select to public using (bucket_id = 'social-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='social_media_auth_insert') then
    create policy "social_media_auth_insert" on storage.objects
      for insert to authenticated with check (bucket_id = 'social-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='social_media_auth_update') then
    create policy "social_media_auth_update" on storage.objects
      for update to authenticated using (bucket_id = 'social-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='social_media_auth_delete') then
    create policy "social_media_auth_delete" on storage.objects
      for delete to authenticated using (bucket_id = 'social-media');
  end if;
end $$;
