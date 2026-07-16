-- Track failed logins alongside successful ones so brute-force attempts are
-- visible. Existing rows are all successes, hence the default.
alter table public.login_events
  add column if not exists success boolean not null default true,
  add column if not exists failure_reason text;

-- Failed rows have no user_id (there is no session on a failed attempt).
alter table public.login_events
  alter column user_id drop not null;

create index if not exists login_events_email_created_idx
  on public.login_events (email, created_at desc);
