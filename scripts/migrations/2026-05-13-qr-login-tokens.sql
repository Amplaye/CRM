-- QR login tokens: one-time tokens that let an owner/manager generate a
-- short-lived URL (rendered as a QR code) which a staff member scans on
-- their phone to log in without a password.

create table if not exists public.qr_login_tokens (
  id uuid default uuid_generate_v4() primary key,
  token text unique not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists idx_qr_login_tokens_token on public.qr_login_tokens(token);
create index if not exists idx_qr_login_tokens_expires on public.qr_login_tokens(expires_at);
create index if not exists idx_qr_login_tokens_user on public.qr_login_tokens(user_id);

alter table public.qr_login_tokens enable row level security;

-- Owners/managers of a tenant can see tokens generated for that tenant; everyone
-- else is blocked. Inserts and updates happen only through the service role
-- (API route) so we keep policies tight.
drop policy if exists "Owners/managers can read tenant qr tokens" on public.qr_login_tokens;
create policy "Owners/managers can read tenant qr tokens"
  on public.qr_login_tokens for select
  using (private.get_tenant_role(tenant_id) in ('owner', 'manager') or private.is_platform_admin());
