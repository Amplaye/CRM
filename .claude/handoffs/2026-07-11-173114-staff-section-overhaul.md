# Handoff: Staff section overhaul — bulk shifts, copy-week, absences, invite visibility (SHIPPED)

## Session Metadata
- Created: 2026-07-11 17:31:14
- Project: /Users/amplaye/CRM
- Branch: main
- Session duration: ~2.5h

### Recent Commits (for context)
  - 7f050b7 Staff polish: compact weekday pills + platform-admin team management
  - 62e6cc6 Staff: bulk rota tool, copy-week, absence management, pending-invite visibility
  - 35db3fd Widget prenotazioni flottante animato + fix bug past_time + stile nuovo
  - 8868d87 Merge: widget prenotazioni premium, siti template autonomi, carosello editabile, cursor pointer globale
  - 3bc9713 Cursor pointer globale su tutti i bottoni

## Handoff Chain

- **Continues from**: None (fresh feature — the auto-linked website-templates handoff is unrelated).
- **Supersedes**: None

## Current State Summary

DONE and shipped to `main` (auto-deploys to Vercel → `crm.baliflowagency.com`), verified LIVE. The user asked to make the `/staff` section usable: the pain was entering every shift by hand, one cell at a time, plus understanding what happens when you invite a member and what each role can do. Delivered: (1) **bulk shift assignment** (members × weekdays × one band → all shifts in one click), (2) **copy-last-week** (add-only), (3) **absence management** (ferie/malattia/personale/imprevisto, single day or range, cancels shifts across the range, shows as grid chips), (4) **pending-invite visibility + a roles explainer** in the team tab, and (5) **removed the duplicate Staff tab from Settings** (now `/staff` is the single home; old `?tab=staff` links redirect). Two commits pushed (62e6cc6 feature, 7f050b7 polish). tsc clean, 878/878 vitest, build OK, live E2E on production confirmed the bulk-create wrote 10 shifts to the DB (then cleaned up). **There is no unfinished work** — remaining items below are optional follow-ups only.

## Codebase Understanding

### Architecture Overview

- `/staff` page (`src/app/(dashboard)/staff/page.tsx`, ~1000 lines, `"use client"`) is a 3-tab workspace: **shifts** (weekly rota grid, members as rows × 7 days), **requests** (time-off/swap inbox), **team** (owner-only, renders `<StaffTab/>`). Reads go straight through Supabase RLS client-side; every WRITE goes through `/api/staff/*` (service-role + `verifyTenantMembership` role check).
- Plan gate: the whole page is locked behind `hasActivePlan(activeTenant?.settings)` (`src/lib/billing/entitlements.ts`). **PICNIC has `plan:null` so /staff is locked there** — must test on a tenant with an active plan (BALI Rest, plan=business/active).
- Roles: DB `owner`/`manager`/`host` → UI `Admin`/`Responsabile`/`Staff`. `platform_admin` (global_role) is treated as owner-level. `verifyTenantMembership(tenantId, ["owner","manager"])` gates manager writes.
- Staff tables (`staff_shifts`, `shift_requests`, `qr_login_tokens`) live in migration files under `scripts/migrations/`, NOT in `supabase-schema.sql`. Migrations applied via Supabase Management API.
- i18n: 4 dictionaries (en/it/es/de) in `src/lib/i18n/dictionaries/`, aligned line-for-line; `Dictionary` type derives from `en.ts`. Every key must exist in all 4 or tsc fails.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| src/app/(dashboard)/staff/page.tsx | The staff page + `BulkAssignPanel`, `AbsenceModal`, `ShiftModal`, `RequestModal` components | Main UI |
| src/components/settings/StaffTab.tsx | Team member list + invite + QR + pending invites + roles help | Team mgmt UI |
| src/lib/staff/shift-rules.ts | Pure rota logic: `findConflict`, `validateShiftInput`, `bandPreset`, `datesInRange`, `weekdayDatesInWeek`, `addDays`, `weekdayIndex` | Shared by APIs + UI, unit-tested |
| src/lib/staff/shift-rules.test.ts | 21 unit tests for the above | Regression guard |
| src/app/api/staff/shifts/bulk/route.ts | POST bulk create (members × dates), conflict-skips | New API |
| src/app/api/staff/shifts/copy-week/route.ts | POST copy source week → target week, add-only | New API |
| src/app/api/staff/absences/route.ts | POST record approved absence (reason_kind + range) / DELETE | New API |
| src/app/api/team/cancel-invite/route.ts | POST delete a pending (unscanned) qr_login_token | New API |
| scripts/migrations/2026-07-11-staff-absences.sql | Adds reason_kind + end_date + manager-insert RLS to shift_requests | Applied live |
| src/app/(dashboard)/settings/page.tsx | Staff tab REMOVED here; `?tab=staff` redirects to /staff | Dedup |

### Key Patterns Discovered

- Push events: `PushEvent` in `src/lib/push/send.ts` is a CLOSED string union with copy hardcoded in 4 langs. Do NOT invent new event names without adding the copy block — the bulk route reuses the existing `shift_new` event instead.
- Date math is done on `YYYY-MM-DD` strings via UTC (`Date.UTC`) to avoid timezone off-by-one — see the helpers in shift-rules.ts. `Date.now()`/`new Date()` are fine in app code (only forbidden inside Workflow scripts).
- Conflict-skip idempotency: bulk/copy routes pull all existing shifts for the window in ONE query, then run `findConflict` in memory per (member,date) pair, pushing accepted candidates into the in-memory set so intra-batch collisions can't happen.
- Absences reuse `shift_requests` (type=`time_off`, status=`approved`, new `reason_kind`+`end_date`) rather than a new table — a manager-created absence is just a pre-approved time-off that cancels shifts across the range. Grid expands these to per-(member,date) chips via `absenceByCell` useMemo.

## Work Completed

### Tasks Finished

- [x] Migration `2026-07-11-staff-absences.sql`: `reason_kind` (vacation/sick/personal/other) + `end_date` on shift_requests + `shift_requests manager insert` RLS policy. Applied live (HTTP 201, columns+policy verified).
- [x] shift-rules.ts helpers (bandPreset, datesInRange, weekdayDatesInWeek, addDays, weekdayIndex) + 21 unit tests (was ~12).
- [x] APIs: `/api/staff/shifts/bulk`, `/api/staff/shifts/copy-week`, `/api/staff/absences` (POST+DELETE), `/api/team/cancel-invite`.
- [x] `/staff` page: bulk-assign panel, copy-week button, absence modal + grid chips, request-list shows reason_kind + absence delete, flash messages.
- [x] StaffTab: pending-invite list (waiting-to-scan) with re-show-QR + cancel, roles-help panel, `canManage` now includes platform_admin.
- [x] Removed duplicate Staff tab from Settings; `?tab=staff` → redirect to /staff.
- [x] i18n for all new UI in en/it/es/de, including short weekday labels `staff_wd_mon…sun`.
- [x] Verified: tsc 0 errors, 878/878 vitest, production build passes, live E2E on BALI Rest (bulk-created 10 shifts confirmed in DB, then deleted; absence round-trip on DB confirmed + cleaned).

### Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| src/app/(dashboard)/staff/page.tsx | +bulk panel, absence modal, grid absence chips, toolbar buttons, copy-week handler, request reason display | Core feature |
| src/components/settings/StaffTab.tsx | +pending invites, roles help, platform_admin canManage | Invite visibility + role clarity |
| src/app/(dashboard)/settings/page.tsx | Removed Staff tab + import + redirect | Dedup |
| src/lib/staff/shift-rules.ts + .test.ts | +date/absence helpers + tests | Shared logic |
| src/lib/i18n/dictionaries/{en,it,es,de}.ts | +staff_bulk_*, staff_absence_*, staff_wd_*, team_help_*, team_pending_* | i18n |
| (new) 4 API route files + 1 migration | see Critical Files | New endpoints |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Copy-week is ADD-ONLY | replace-all vs add-only | User chose "fill the gaps, never duplicate" — safe to click twice. |
| Absences = pre-approved time_off in shift_requests | new absences table vs reuse | Reuse: the table already models "member off on date with reason"; avoids a new table + P&L implications (migration explicitly says no wages). |
| Manager records absence directly (already approved) | only approve waiter self-requests | User wanted full staff control (holiday/sick/imprevisto) — manager decides, no waiter action needed. |
| Removed Settings Staff tab (not /staff team tab) | keep both vs pick one | The two were identical; /staff is next to the rota, so it's the natural home. Redirect preserves old links. |
| Absences support single day OR range (end_date) | single-day only | Vacation is usually multi-day — one request row covers work_date..end_date. |
| Reuse `shift_new` push for bulk (not a new event) | new bulk event vs reuse | PushEvent is a closed union; one push per member (not per shift) avoids a storm. |

## Immediate Next Steps

The feature is complete and shipped. If the user wants to extend it:
1. **If asked to verify UI again**: log in at `crm.baliflowagency.com` as Platform Admin (`admin@baliflow.com`), switch tenant via the Shield/"Platform Admin" switcher → search "BALI" → BALI Rest (has active plan), then go to /staff. PICNIC is plan-locked. Playwright script pattern: fill `input[type=email]`/`input[type=password]`, click `button[type=submit]`, then the switcher. Run the .mjs from inside `/Users/amplaye/CRM` (not scratchpad) so `playwright` resolves; delete the temp file after.
2. **Possible follow-up**: bulk tool operates only on the visible week's weekdays; a multi-week bulk (date range) was NOT built — mention it if the user wants recurring/templated rotas beyond one week.
3. **Possible follow-up**: `qr_login_tokens` is not in the realtime publication, so pending invites refresh on mount/after-invite, not live. Add to `supabase_realtime` publication if the user wants live pending updates.

### Blockers/Open Questions

- None. Feature verified end-to-end.

### Deferred Items

- Live realtime for pending-invite list (currently fetch-on-mount + after-invite) — not requested.
- Copy-week UI has no "which week to copy from" picker; it always copies the immediately-previous week. Fine for the stated need.

## Context for Resuming Agent

## Important Context

**The work is DONE and in production. Do not re-implement it.** If the user reports a bug or wants an extension, the entry points are the files in the Critical Files table. The single most important gotcha: **/staff is plan-gated** — on PICNIC (no active plan) the page shows a lock card and NONE of the new tools render. This is not a bug; test on BALI Rest or another active-plan tenant. The staff tables are NOT in `supabase-schema.sql` — only in `scripts/migrations/*.sql`; the migration was already applied live to project `azhlnybiqlkbhbboyvud` via the Supabase Management API.

### Assumptions Made

- BALI Rest and Oraz have active `business` plans (verified via DB query); PICNIC does not.
- Auto-deploy from `main` to Vercel is working (per CLAUDE.md + confirmed live this session).
- The user's global rule: ask questions ONLY by voice via `/Users/amplaye/.claude/voice/ask_voice.sh "<domanda>"` in Italian. Honor this.

### Potential Gotchas

- Adding an i18n key to en.ts but not the other 3 dictionaries → tsc failure (Dictionary type derives from en). Always edit all 4.
- `settings_day_*` are FULL day names (Wednesday/Mercoledì/Miércoles/Mittwoch) — they overflow compact pills. Use `staff_wd_*` (short) for pill-sized UI.
- Playwright scripts must run from the CRM dir (node_modules resolution) — copy .mjs into /Users/amplaye/CRM, run, then `rm`. Scratchpad is at `/private/tmp/claude-501/-Users-amplaye/abe333af-b9cf-49fb-b65e-54f7fc69259e/scratchpad`.
- Supabase Management API: send a browser User-Agent header or Cloudflare returns "403 code 1010" (bot-block).
- CLAUDE.md rules: NEVER `npm run dev` (no Next dev server); one heavy process at a time (prefer vitest/tsc/build separately). WhatsApp = Meta Cloud API not Twilio. system_logs uses `title`+`description` not `message`.

## Environment State

### Tools/Services Used

- Supabase Management API (project ref `azhlnybiqlkbhbboyvud`) for the migration + verification queries + test-data cleanup. Token is in the user's memory `credentials.md` under "BaliFlow CRM (Supabase)" — do NOT paste it into files.
- Playwright 1.60 (chromium) for live E2E against crm.baliflowagency.com.
- Vercel auto-deploy from main.

### Active Processes

- None. No dev server, no background jobs left running. All test data was deleted (verified 0 leftover rows).

### Environment Variables

- Relevant NAMES only: `NEXT_PUBLIC_SUPABASE_URL`, service-role key, `POS_CRED_ENC_KEY`. Values live in Vercel env + the user's memory `credentials.md`. Never inline them.

## Related Resources

- Memory note written this session: `~/.claude/projects/-Users-amplaye/memory/feature_baliflow_crm_staff_overhaul.md` (+ pointer in MEMORY.md).
- Base 3-role/QR model: memory `feature_baliflow_crm_team_3_roles.md`, `feature_baliflow_crm_staff_qr_login.md`.
- Prior staff shift feature: `scripts/migrations/2026-07-08-staff-shifts.sql`.
- Plan gate: `src/lib/billing/entitlements.ts` (`hasActivePlan`).

---

**Security Reminder**: No secrets in this file — tokens/keys are referenced by location only.
