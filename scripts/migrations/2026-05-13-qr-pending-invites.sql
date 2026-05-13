-- Extend qr_login_tokens to carry "pending staff invite" data so the actual
-- Supabase user is created lazily, on first scan, instead of at QR generation
-- time. user_id can now be NULL until consumed; pending_name + pending_role
-- describe who should be created on consume.

alter table public.qr_login_tokens alter column user_id drop not null;
alter table public.qr_login_tokens add column if not exists pending_name text;
alter table public.qr_login_tokens add column if not exists pending_role text;
