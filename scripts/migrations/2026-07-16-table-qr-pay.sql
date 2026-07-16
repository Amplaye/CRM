-- Pay-at-table via the table QR (2026-07-16).
--
-- The guest scans the SAME QR already on the table (/m/<slug>?table=<id>),
-- opens their bill and pays it with Stripe Checkout. The money goes to the
-- TENANT'S OWN Stripe account: the key lives encrypted in payment_secrets
-- (provider 'stripe', BYO-key pattern identical to the tenant Resend key) —
-- there is no platform fallback, no key = no QR payments for that tenant.
--
-- cassa_qr_payments maps each Stripe Checkout Session to the cassa order it
-- pays. The amount is frozen at checkout-creation time; the confirm step
-- (called by the guest's phone on return from Stripe) re-verifies the session
-- against Stripe with the tenant key, compares the amount with the CURRENT
-- server-side total, and only then settles the order through the same atomic
-- fiscal path as the till (method 'online'). unique(stripe_session_id) makes
-- the confirm idempotent under double-taps and webhookless retries.
--
-- status:
--   pending          checkout created, guest is on the Stripe page
--   settled          verified paid + order closed with a receipt
--   amount_mismatch  guest paid, but the bill changed meanwhile → staff settles
--                    by hand (critical system_log raised)
--   failed           verified-paid money on a bill no longer open (e.g. staff
--                    charged it at the till meanwhile) → possible double charge,
--                    staff refunds from Stripe (critical system_log raised)

create table if not exists public.cassa_qr_payments (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid references public.cassa_orders(id) on delete set null,
  table_id uuid,
  table_name text not null default '',
  stripe_session_id text not null,
  amount_cents integer not null,
  currency text not null default 'eur',
  status text not null default 'pending'
    check (status in ('pending','settled','amount_mismatch','failed')),
  receipt_number integer,
  receipt_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_cassa_qr_payments_session unique (stripe_session_id)
);

create index if not exists idx_cassa_qr_payments_tenant
  on public.cassa_qr_payments (tenant_id, created_at desc);
create index if not exists idx_cassa_qr_payments_order
  on public.cassa_qr_payments (order_id);

alter table public.cassa_qr_payments enable row level security;

-- Members see their venue's QR payments (read-only); all writes go through the
-- service-role public routes. Same posture as cassa_payments.
create policy "cassa_qr_payments tenant read" on public.cassa_qr_payments
  for select using (private.is_tenant_member(tenant_id));
create policy "cassa_qr_payments admin access" on public.cassa_qr_payments
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());
