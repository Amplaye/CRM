-- ============================================
-- 2026-05-28: Add slug to tenants for public menu URLs (/m/<slug>)
-- ============================================
-- Slug is unique, URL-safe, kebab-case. Empty/legacy tenants get
-- "tenant-<first8>" so the column can be NOT NULL UNIQUE from day one.

alter table public.tenants add column if not exists slug text;

-- Backfill existing rows. Lowercase, strip non-alphanumerics, then
-- replace runs of "-" with a single dash, trim leading/trailing dashes.
-- If the resulting slug is empty or would collide, append the first 8
-- chars of the id.
update public.tenants
set slug = trim(both '-' from regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g'))
where slug is null;

-- Disambiguate empty / colliding values.
update public.tenants t
set slug = case
  when t.slug is null or t.slug = '' then 'tenant-' || left(t.id::text, 8)
  else t.slug || '-' || left(t.id::text, 8)
end
where t.slug is null
   or t.slug = ''
   or exists (
     select 1 from public.tenants t2
     where t2.slug = t.slug and t2.id <> t.id
   );

alter table public.tenants alter column slug set not null;
create unique index if not exists idx_tenants_slug on public.tenants(slug);
