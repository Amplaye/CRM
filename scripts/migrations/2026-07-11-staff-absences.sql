-- ============================================================================
-- STAFF ABSENCES (ferie / malattia / imprevisto) — 2026-07-11
-- ============================================================================
-- Extends shift_requests so a time-off record can carry WHY (vacation / sick /
-- personal / other) and span a RANGE of days, and so a manager can record an
-- absence directly (already approved) instead of only approving a waiter's
-- self-request. Still not an HR system — no wages; this is scheduling only.
--
--   • reason_kind: category of a time_off (null for swaps / legacy rows).
--   • end_date: last day of a multi-day absence (null = single day = work_date).
--     A vacation week is ONE request row covering work_date..end_date.
--   • The manager-created absence path (API ?action=manager) inserts a row
--     already status='approved' and cancels the member's shifts across the
--     whole range — same side-effect as approving a time_off, but for any
--     member and any date span.
--   • RLS: the existing "own insert" (waiter self-request) stays; we ADD an
--     owner/manager insert so a manager can create an absence for someone else.
--     All API writes are service-role anyway — these policies are the
--     browser-side floor.
--   • Idempotent: safe to re-paste into the Supabase SQL editor.
-- ============================================================================

alter table public.shift_requests
  add column if not exists reason_kind text
    check (reason_kind is null or reason_kind in ('vacation','sick','personal','other'));

alter table public.shift_requests
  add column if not exists end_date date;  -- null = single day (= work_date)

-- Owner/manager may insert a request for ANY member of the tenant (recording an
-- absence on someone's behalf). The narrower "own insert" policy remains for
-- waiters requesting their own time off / swaps.
drop policy if exists "shift_requests manager insert" on public.shift_requests;
create policy "shift_requests manager insert" on public.shift_requests
  for insert with check (
    (private.get_tenant_role(tenant_id) in ('owner','manager') or private.is_platform_admin())
    and member_id in (select id from public.tenant_members where tenant_id = shift_requests.tenant_id)
  );
