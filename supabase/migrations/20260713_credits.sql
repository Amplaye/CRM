-- ============================================================================
-- CREDITS  (prepaid usage meter — Topbar badge + Settings → Credits)
-- ============================================================================
-- Until now nothing measured what a tenant actually BURNS: every OpenAI call,
-- every Meta marketing conversation, every voice minute was a live cost with no
-- ceiling. A €99/month voice add-on could run €300 of Vapi minutes and nobody
-- would notice. (/api/admin/usage only *pretends* to measure — it counts DB rows
-- and multiplies by hard-coded constants.)
--
-- Two tables, same security shape as `subscriptions`: members read, service-role
-- writes.
--   • credit_balances — one row per tenant (upsert target). The wallet.
--   • credit_events   — append-only ledger, one row per metered action.
--
-- MILLICREDITS. 1 credit = €0.20 = 1000 mc. Every column is a bigint in mc, and
-- the `_mc` suffix says so at every call site. A bot message costs 0.04 credits
-- (40 mc); storing that as a float and subtracting it a few hundred thousand
-- times is how a balance quietly drifts. Integers cannot drift. The UI divides
-- by 1000 exactly once, in formatCredits().
-- ============================================================================

create table if not exists public.credit_balances (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- Plan credits: reset to `included_granted_mc` on every billing renewal.
  included_remaining_mc bigint not null default 0,
  -- Bought credits (one-off packs): never expire, never reset.
  purchased_remaining_mc bigint not null default 0,
  -- This cycle's plan allowance — the denominator of the "used X%" bar.
  included_granted_mc bigint not null default 0,
  period_start timestamptz,
  updated_at timestamptz not null default now(),
  -- A balance can never go negative: consume_credits refuses to overdraw, and
  -- this is the backstop if anything ever writes the columns directly.
  constraint credit_balances_non_negative
    check (included_remaining_mc >= 0 and purchased_remaining_mc >= 0)
);

create table if not exists public.credit_events (
  id uuid default uuid_generate_v4() primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- bot_message | marketing_whatsapp | marketing_email | voice_minute |
  -- invoice_ocr | menu_import | transcription | ai_text | topup | plan_reset
  -- Deliberately NOT a check constraint: the catalog (credits-catalog.ts) owns
  -- the action list, and adding an action there must not require a migration.
  action_type text not null,
  -- Negative = consumption, positive = top-up / monthly reset.
  credits_mc bigint not null,
  -- Our real cost in EUR (Meta's per-country price, OpenAI tokens, Vapi minute)
  -- so the admin side can see the actual margin, not the assumed one.
  cost_eur numeric(10, 5),
  metadata jsonb not null default '{}'::jsonb,  -- model, tokens, campaign_id, phone_country…
  created_at timestamptz not null default now()
);
create index if not exists idx_credit_events_tenant_created
  on public.credit_events(tenant_id, created_at desc);

-- ---- RLS ----
alter table public.credit_balances enable row level security;
alter table public.credit_events enable row level security;

-- Members read their own tenant's wallet + ledger; only service-role (the API,
-- the webhooks, the RPC) and platform admins may write. A tenant must never be
-- able to top itself up with an UPDATE.
create policy "credit_balances tenant read" on public.credit_balances
  for select using (private.is_tenant_member(tenant_id));
create policy "credit_balances admin access" on public.credit_balances
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy "credit_events tenant read" on public.credit_events
  for select using (private.is_tenant_member(tenant_id));
create policy "credit_events admin access" on public.credit_events
  for all using (private.is_platform_admin()) with check (private.is_platform_admin());

-- ---- Realtime ----
-- The Topbar badge subscribes to its tenant's balance row so the number drops
-- live as the bot answers, and jumps the moment a top-up webhook lands — no
-- polling. Like `tenants`, the table must be IN the publication or the client
-- subscribes successfully and then silently receives nothing.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'credit_balances'
  ) then
    alter publication supabase_realtime add table public.credit_balances;
  end if;
end $$;

-- ============================================================================
-- consume_credits — the ONLY way credits leave a wallet.
-- ============================================================================
-- Atomic on purpose. The bot answers several WhatsApp conversations in parallel
-- and the marketing sender loops hundreds of recipients: a read-then-write in
-- application code would let two concurrent consumes both read "40 mc left",
-- both pass, and both debit — overdrawing the wallet. Here the UPDATE ... SET
-- x = x - n takes a row lock, so concurrent callers serialize on it, and the
-- balance check happens INSIDE that lock.
--
-- Spends INCLUDED credits first, then PURCHASED ones — the monthly allowance is
-- use-it-or-lose-it, the bought ones never expire, so burning the perishable
-- ones first is what the customer would choose.
--
-- Returns ok=false WITHOUT debiting and WITHOUT writing the ledger when the
-- combined balance is short. Never partially debits.
-- ============================================================================
create or replace function public.consume_credits(
  p_tenant_id uuid,
  p_action text,
  p_credits_mc bigint,
  p_cost_eur numeric default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (ok boolean, remaining_mc bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_included bigint;
  v_purchased bigint;
  v_from_included bigint;
  v_from_purchased bigint;
begin
  if p_credits_mc is null or p_credits_mc < 0 then
    raise exception 'consume_credits: p_credits_mc must be >= 0 (got %)', p_credits_mc;
  end if;

  -- Materialize the wallet on first use, so a tenant that never bought credits
  -- still has a row to lock (and to show a zero balance in the UI).
  insert into public.credit_balances (tenant_id)
    values (p_tenant_id)
    on conflict (tenant_id) do nothing;

  -- FOR UPDATE: the lock that makes the whole thing atomic. Everything below
  -- runs with concurrent consumers for this tenant queued behind us.
  select cb.included_remaining_mc, cb.purchased_remaining_mc
    into v_included, v_purchased
    from public.credit_balances cb
    where cb.tenant_id = p_tenant_id
    for update;

  if coalesce(v_included, 0) + coalesce(v_purchased, 0) < p_credits_mc then
    -- Insufficient: refuse cleanly. No debit, no ledger row.
    return query select false, coalesce(v_included, 0) + coalesce(v_purchased, 0);
    return;
  end if;

  v_from_included := least(v_included, p_credits_mc);
  v_from_purchased := p_credits_mc - v_from_included;

  update public.credit_balances
     set included_remaining_mc = included_remaining_mc - v_from_included,
         purchased_remaining_mc = purchased_remaining_mc - v_from_purchased,
         updated_at = now()
   where tenant_id = p_tenant_id;

  -- Ledger: negative = spent.
  insert into public.credit_events (tenant_id, action_type, credits_mc, cost_eur, metadata)
    values (p_tenant_id, p_action, -p_credits_mc, p_cost_eur, coalesce(p_metadata, '{}'::jsonb));

  return query
    select true, (v_included - v_from_included) + (v_purchased - v_from_purchased);
end;
$$;

-- ============================================================================
-- grant_credits — top-ups (Stripe pack) and the monthly plan reset.
-- ============================================================================
-- `p_kind`:
--   'purchased'  → ADD to purchased_remaining_mc (a bought pack; never expires).
--   'included'   → SET included_remaining_mc AND included_granted_mc to the plan
--                  allowance and stamp period_start. A reset, not an addition:
--                  last month's unused allowance does not roll over. Idempotent
--                  by design — a re-delivered renewal webhook re-sets the same
--                  numbers rather than doubling them.
-- ============================================================================
create or replace function public.grant_credits(
  p_tenant_id uuid,
  p_kind text,
  p_credits_mc bigint,
  p_action text default 'topup',
  p_metadata jsonb default '{}'::jsonb
)
returns table (ok boolean, remaining_mc bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_included bigint;
  v_purchased bigint;
begin
  if p_credits_mc is null or p_credits_mc < 0 then
    raise exception 'grant_credits: p_credits_mc must be >= 0 (got %)', p_credits_mc;
  end if;
  if p_kind not in ('purchased', 'included') then
    raise exception 'grant_credits: p_kind must be purchased|included (got %)', p_kind;
  end if;

  insert into public.credit_balances (tenant_id)
    values (p_tenant_id)
    on conflict (tenant_id) do nothing;

  if p_kind = 'purchased' then
    update public.credit_balances
       set purchased_remaining_mc = purchased_remaining_mc + p_credits_mc,
           updated_at = now()
     where tenant_id = p_tenant_id
    returning included_remaining_mc, purchased_remaining_mc into v_included, v_purchased;
  else
    update public.credit_balances
       set included_remaining_mc = p_credits_mc,
           included_granted_mc = p_credits_mc,
           period_start = now(),
           updated_at = now()
     where tenant_id = p_tenant_id
    returning included_remaining_mc, purchased_remaining_mc into v_included, v_purchased;
  end if;

  insert into public.credit_events (tenant_id, action_type, credits_mc, metadata)
    values (p_tenant_id, p_action, p_credits_mc, coalesce(p_metadata, '{}'::jsonb));

  return query select true, v_included + v_purchased;
end;
$$;

-- Callable by the API/webhooks (service-role) and platform admins only. A member
-- must never be able to call grant_credits and mint themselves a balance.
revoke all on function public.consume_credits(uuid, text, bigint, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.grant_credits(uuid, text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, text, bigint, numeric, jsonb) to service_role;
grant execute on function public.grant_credits(uuid, text, bigint, text, jsonb) to service_role;
