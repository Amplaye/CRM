-- ============================================
-- 2026-06-01: Menu import jobs (async PDF extraction)
-- ============================================
-- Background-job table for off-request menu extraction. On Vercel Hobby every
-- function is hard-capped at 60s, but large PDFs take 60-120s+ to extract via
-- OpenAI vision. So the slow work is moved to a Supabase Edge Function (150s
-- wall-clock on Free): POST /api/menu/import-job inserts a 'pending' row with
-- the uploaded file as base64, fire-and-forgets the Edge Function, and returns
-- a jobId immediately. The Edge Function does the OpenAI call and writes back
-- result/error. The dashboard polls GET /api/menu/import-job/[id] until done.
--
-- Writes (insert by the create route, update by the Edge Function) go through
-- the service role and bypass RLS, mirroring qr_login_tokens. Members only need
-- SELECT here so the dashboard can poll its own tenant's jobs.

create table if not exists public.menu_import_jobs (
  id          uuid default uuid_generate_v4() primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending','processing','done','error')),
  source      text not null default 'file'
              check (source in ('file','url','text')),
  -- The uploaded file lives here between upload and processing. base64 of the
  -- PDF/image; nulled out once the job finishes so blobs don't accumulate.
  file_base64 text,
  media_type  text,            -- 'application/pdf' | 'image/png' | ... ; null for url/text
  source_url  text,            -- for url jobs
  source_text text,            -- for scraped-text jobs
  result      jsonb,           -- the ExtractedMenu on success
  error       text,            -- human-readable failure reason
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_menu_import_jobs_tenant
  on public.menu_import_jobs(tenant_id, created_at desc);
create index if not exists idx_menu_import_jobs_status
  on public.menu_import_jobs(status) where status in ('pending','processing');

alter table public.menu_import_jobs enable row level security;

-- Tenant members can read their own tenant's jobs (the dashboard polls).
create policy "menu_import_jobs tenant read" on public.menu_import_jobs
  for select using (private.is_tenant_member(tenant_id));

-- Platform admins can do everything.
create policy "menu_import_jobs admin all" on public.menu_import_jobs
  for all using (private.is_platform_admin())
  with check (private.is_platform_admin());
