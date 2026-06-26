-- ============================================================================
-- PLAN-AWARE RLS  (freemium "entry package" gate)
-- ----------------------------------------------------------------------------
-- A tenant with NO active subscription ("entry package") may use ONLY the menu
-- editor + public menu + Settings. Every core CRM section is locked. The sidebar
-- + page-level LockedPreview are COSMETIC; this migration is the real backstop for
-- direct authenticated reads/writes of the operational/PII tables.
--
-- Mechanism: a single SECURITY DEFINER helper `private.tenant_has_active_plan()`
-- that mirrors src/lib/billing/entitlements.ts → hasActivePlan(), plus ONE
-- RESTRICTIVE policy per locked table. Restrictive policies are AND-combined with
-- the existing permissive (membership/role) policies, so they only ever *remove*
-- access — a tenant member can read/write these tables only if their tenant also
-- has an active plan. Nothing here touches or rewrites the existing policies, so
-- it is fully reversible (drop the policies + function to roll back).
--
-- NOT gated (entry package needs them): menu_* tables, tenants/tenant_members,
-- restaurant_tables (the public menu + floor map plumbing). The public menu
-- (/m/<slug>) and the bot/API routes run as service_role, which BYPASSES RLS —
-- those paths are gated separately in code (assertActivePlan) and stay working.
--
-- ⚠️ DEPLOY ORDER: apply this ONLY after every paying tenant has
-- settings.billing.plan + status set (active/trialing), or they will be locked out
-- of their own data. Verify with:
--   select id, name, settings->'billing'->>'plan' as plan,
--          settings->'billing'->>'status' as status,
--          private.tenant_has_active_plan(id) as has_plan
--   from public.tenants where status in ('active','trial');
-- ============================================================================

-- Helper: does this tenant currently have an active paid plan? Mirrors the JS
-- hasActivePlan(): plan present + status active/trialing → true; past_due within
-- the 7-day grace window (lenient when current_period_end is missing) → true;
-- anything else (no plan / canceled / incomplete / expired) → false. Coalesced so
-- a missing tenant or missing billing block is a definite false (never NULL).
create or replace function private.tenant_has_active_plan(p_tenant_id uuid)
returns boolean as $$
  select coalesce((
    select case
      when b is null then false
      when (b->>'plan') is null then false
      when (b->>'status') in ('active', 'trialing') then true
      when (b->>'status') = 'past_due' then
        case
          when (b->>'current_period_end') is null then true   -- lenient: webhook will stamp a date soon
          else now() <= ((b->>'current_period_end')::timestamptz + interval '7 days')
        end
      else false
    end
    from public.tenants t
    left join lateral (select t.settings->'billing' as b) z on true
    where t.id = p_tenant_id
  ), false);
$$ language sql security definer stable set search_path = public, pg_temp;

grant execute on function private.tenant_has_active_plan(uuid) to authenticated, service_role;

-- ── Restrictive plan gate, one per locked table ────────────────────────────
-- `as restrictive for all` is AND-combined with the existing permissive policies
-- and covers select/insert/update/delete (USING + WITH CHECK). Platform admins
-- keep full access for support. service_role bypasses RLS entirely (bot, public
-- menu, webhooks), so it is unaffected.

drop policy if exists "Active plan required — reservations" on public.reservations;
create policy "Active plan required — reservations" on public.reservations
  as restrictive for all
  using (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin())
  with check (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin());

drop policy if exists "Active plan required — reservation_events" on public.reservation_events;
create policy "Active plan required — reservation_events" on public.reservation_events
  as restrictive for all
  using (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin())
  with check (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin());

drop policy if exists "Active plan required — waitlist_entries" on public.waitlist_entries;
create policy "Active plan required — waitlist_entries" on public.waitlist_entries
  as restrictive for all
  using (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin())
  with check (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin());

drop policy if exists "Active plan required — guests" on public.guests;
create policy "Active plan required — guests" on public.guests
  as restrictive for all
  using (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin())
  with check (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin());

drop policy if exists "Active plan required — conversations" on public.conversations;
create policy "Active plan required — conversations" on public.conversations
  as restrictive for all
  using (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin())
  with check (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin());

drop policy if exists "Active plan required — knowledge_articles" on public.knowledge_articles;
create policy "Active plan required — knowledge_articles" on public.knowledge_articles
  as restrictive for all
  using (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin())
  with check (private.tenant_has_active_plan(tenant_id) or private.is_platform_admin());

-- Rollback (manual):
--   drop policy if exists "Active plan required — reservations" on public.reservations;
--   drop policy if exists "Active plan required — reservation_events" on public.reservation_events;
--   drop policy if exists "Active plan required — waitlist_entries" on public.waitlist_entries;
--   drop policy if exists "Active plan required — guests" on public.guests;
--   drop policy if exists "Active plan required — conversations" on public.conversations;
--   drop policy if exists "Active plan required — knowledge_articles" on public.knowledge_articles;
--   drop function if exists private.tenant_has_active_plan(uuid);
