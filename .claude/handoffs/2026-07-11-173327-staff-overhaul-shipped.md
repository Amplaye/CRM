# Handoff: Staff section overhaul — bulk shifts, copy-week, absences, invite visibility (SHIPPED)

## Session Metadata
- Created: 2026-07-11 17:33:27
- Project: /Users/amplaye/CRM
- Branch: main
- Session duration: ~2.5h

### Recent Commits (for context)
  - 7f050b7 Staff polish: compact weekday pills + platform-admin team management
  - 62e6cc6 Staff: bulk rota tool, copy-week, absence management, pending-invite visibility
  - 35db3fd Widget prenotazioni flottante animato + fix bug past_time + stile nuovo
  - 8868d87 Merge: widget prenotazioni premium, siti template autonomi, carosello editabile
  - 3bc9713 Cursor pointer globale su tutti i bottoni

## Handoff Chain

- **Continues from**: None (fresh feature).
- **Supersedes**: 2026-07-11-173114-staff-section-overhaul.md (same session, re-run of CREATE — identical content).

## Current State Summary

DONE and shipped to `main` (auto-deploys to Vercel → `crm.baliflowagency.com`), verified LIVE. The user asked to make `/staff` usable: the pain was entering every shift by hand, one cell at a time, plus understanding what happens when you invite a member and what each role can do. Delivered: (1) **bulk shift assignment** (members × weekdays × one band → all shifts in one click), (2) **copy-last-week** (add-only), (3) **absence management** (ferie/malattia/personale/imprevisto, single day or range, cancels shifts across the range, shows as grid chips), (4) **pending-invite visibility + a roles explainer** in the team tab, and (5) **removed the duplicate Staff tab from Settings** (now `/staff` is the single home; old `?tab=staff` redirects). Two commits pushed (62e6cc6 feature, 7f050b7 polish). tsc clean, 878/878 vitest, build OK, live E2E on production confirmed the bulk-create wrote 10 shifts to the DB (then cleaned up). **No unfinished work** — remaining items are optional follow-ups only.

## Codebase Understanding

### Architecture Overview

- `/staff` page (`src/app/(dashboard)/staff/page.tsx`, ~1000 lines, `"use client"`) is a 3-tab workspace: **shifts** (weekly rota grid, members as rows × 7 days), **requests** (time-off/swap inbox), **team** (owner-only, renders `<StaffTab/>`). Reads go through Supabase RLS client-side; WRITES go through `/api/staff/*` (service-role + `verifyTenantMembership` role check).
- Plan gate: whole page locked behind `hasActivePlan(activeTenant?.settings)` (`src/lib/billing/entitlements.ts`). **PICNIC has `plan:null` so /staff is locked there** — test on a tenant with an active plan (BALI Rest = business/active).
- Roles: DB `owner`/`manager`/`host` → UI `Admin`/`Responsabile`/`Staff`. `platform_admin` (global_role) is treated as owner-level.
- Staff tables (`staff_shifts`, `shift_requests`, `qr_login_tokens`) live in migration files under `scripts/migrations/`, NOT in `supabase-schema.sql`. Migrations applied via Supabase Management API.
- i18n: 4 dictionaries (en/it/es/de), aligned line-for-line; `Dictionary` type derives from `en.ts`. Every key must exist in all 4 or tsc fails.

### Critical Files

| File | Purpose |
|------|---------|
| src/app/(dashboard)/staff/page.tsx | Staff page + BulkAssignPanel, AbsenceModal, ShiftModal, RequestModal |
| src/components/settings/StaffTab.tsx | Team list + invite + QR + pending invites + roles help |
| src/lib/staff/shift-rules.ts | Pure rota logic (findConflict, validateShiftInput, bandPreset, datesInRange, weekdayDatesInWeek, addDays, weekdayIndex) |
| src/lib/staff/shift-rules.test.ts | 21 unit tests |
| src/app/api/staff/shifts/bulk/route.ts | POST bulk create, conflict-skips |
| src/app/api/staff/shifts/copy-week/route.ts | POST copy source→target week, add-only |
| src/app/api/staff/absences/route.ts | POST approved absence (reason_kind + range) / DELETE |
| src/app/api/team/cancel-invite/route.ts | POST delete a pending qr_login_token |
| scripts/migrations/2026-07-11-staff-absences.sql | reason_kind + end_date + manager-insert RLS (applied live) |
| src/app/(dashboard)/settings/page.tsx | Staff tab REMOVED; ?tab=staff redirects to /staff |

### Key Patterns Discovered

- `PushEvent` in `src/lib/push/send.ts` is a CLOSED union with 4-lang copy hardcoded. Don't invent event names — bulk route reuses `shift_new`.
- Date math on `YYYY-MM-DD` strings via `Date.UTC` to avoid tz off-by-one (helpers in shift-rules.ts). `Date.now()`/`new Date()` fine in app code.
- Conflict-skip idempotency: bulk/copy pull all existing shifts for the window in ONE query, run `findConflict` in memory per (member,date), pushing accepted candidates into the in-memory set so intra-batch collisions can't happen.
- Absences reuse `shift_requests` (type=time_off, status=approved, +reason_kind +end_date), not a new table. Grid expands to per-(member,date) chips via `absenceByCell` useMemo.

## Work Completed

### Tasks Finished

- [x] Migration `2026-07-11-staff-absences.sql` applied live (columns + `shift_requests manager insert` policy verified).
- [x] shift-rules helpers + 21 unit tests.
- [x] APIs: /api/staff/shifts/bulk, /copy-week, /api/staff/absences (POST+DELETE), /api/team/cancel-invite.
- [x] /staff page: bulk panel, copy-week button, absence modal + grid chips, request reason + absence delete, flash messages.
- [x] StaffTab: pending-invite list + re-show-QR + cancel, roles-help, canManage includes platform_admin.
- [x] Removed Settings Staff tab; ?tab=staff redirect.
- [x] i18n en/it/es/de incl. short weekday labels staff_wd_mon…sun.
- [x] Verified: tsc 0, 878/878 vitest, build OK, live E2E (bulk 10 shifts in DB then deleted; absence round-trip on DB then cleaned).

### Files Modified

| File | Changes |
|------|---------|
| src/app/(dashboard)/staff/page.tsx | bulk panel, absence modal + grid chips, toolbar, copy-week, request reason |
| src/components/settings/StaffTab.tsx | pending invites, roles help, platform_admin canManage |
| src/app/(dashboard)/settings/page.tsx | removed Staff tab + import + redirect |
| src/lib/staff/shift-rules.ts + .test.ts | date/absence helpers + tests |
| src/lib/i18n/dictionaries/{en,it,es,de}.ts | staff_bulk_*, staff_absence_*, staff_wd_*, team_help_*, team_pending_* |
| (new) 4 API routes + 1 migration | see Critical Files |

### Decisions Made

| Decision | Rationale |
|----------|-----------|
| Copy-week ADD-ONLY | User chose "fill gaps, never duplicate" — safe to click twice. |
| Absences = pre-approved time_off in shift_requests | Table already models "member off on date w/ reason"; avoids new table + P&L (migration says no wages). |
| Manager records absence directly (already approved) | User wanted full staff control; manager decides, no waiter action. |
| Removed Settings Staff tab (kept /staff) | Two were identical; /staff sits next to rota. Redirect preserves links. |
| Absences single day OR range (end_date) | Vacation is multi-day — one row covers work_date..end_date. |
| Reuse `shift_new` push (not new event) | PushEvent is closed; one push per member avoids storm. |

## Immediate Next Steps

Feature is complete and shipped. If the user wants to extend it:
1. **To verify UI**: log in at crm.baliflowagency.com as Platform Admin (`admin@baliflow.com`), switch tenant via the "Platform Admin"/Shield switcher → search "BALI" → BALI Rest (active plan), then /staff. PICNIC is plan-locked. Run any Playwright .mjs from INSIDE /Users/amplaye/CRM (so `playwright` resolves), then delete it.
2. **Possible follow-up**: bulk operates only on the visible week's weekdays; multi-week/recurring rotas were NOT built.
3. **Possible follow-up**: `qr_login_tokens` not in realtime publication → pending invites refresh on mount/after-invite, not live. Add to `supabase_realtime` if live updates wanted.

### Blockers/Open Questions

- None. Feature verified end-to-end.

### Deferred Items

- Live realtime for pending-invite list (currently fetch-on-mount + after-invite) — not requested.
- Copy-week always copies the immediately-previous week (no source-week picker) — fine for the stated need.

## Important Context

**The work is DONE and in production. Do not re-implement it.** If the user reports a bug or wants an extension, entry points are the Critical Files. Single biggest gotcha: **/staff is plan-gated** — on PICNIC (no plan) the page shows a lock card and NONE of the new tools render. Not a bug; test on BALI Rest. Staff tables are NOT in `supabase-schema.sql` — only in `scripts/migrations/*.sql`; the migration was already applied live to project `azhlnybiqlkbhbboyvud` via Supabase Management API.

### Assumptions Made

- BALI Rest and Oraz have active `business` plans (verified via DB); PICNIC does not.
- Auto-deploy from `main` to Vercel works (confirmed live).
- User's global rule: ask questions ONLY by voice via `/Users/amplaye/.claude/voice/ask_voice.sh "<domanda>"` in Italian.

### Potential Gotchas

- i18n key in en.ts but not the other 3 → tsc failure (Dictionary derives from en). Edit all 4.
- `settings_day_*` are FULL day names — they overflow compact pills. Use `staff_wd_*` (short) for pill UI.
- Playwright must run from CRM dir; scratchpad at `/private/tmp/claude-501/-Users-amplaye/abe333af-b9cf-49fb-b65e-54f7fc69259e/scratchpad`.
- Supabase Management API: send a browser User-Agent or Cloudflare returns "403 code 1010".
- CLAUDE.md: NEVER `npm run dev`; one heavy process at a time; WhatsApp = Meta Cloud API not Twilio; system_logs uses title+description not message.

## Environment State

### Tools/Services Used

- Supabase Management API (project ref `azhlnybiqlkbhbboyvud`) for migration + verification + test-data cleanup. Token in memory `credentials.md` — do NOT paste into files.
- Playwright 1.60 (chromium) for live E2E.
- Vercel auto-deploy from main.

### Active Processes

- None. No dev server, no background jobs. All test data deleted (verified 0 leftover rows).

### Environment Variables

- NAMES only: `NEXT_PUBLIC_SUPABASE_URL`, service-role key, `POS_CRED_ENC_KEY`. Values in Vercel env + memory. Never inline.

## Related Resources

- Memory note this session: `~/.claude/projects/-Users-amplaye/memory/feature_baliflow_crm_staff_overhaul.md` (+ MEMORY.md pointer).
- Base 3-role/QR: memory `feature_baliflow_crm_team_3_roles.md`, `feature_baliflow_crm_staff_qr_login.md`.
- Prior staff shifts: `scripts/migrations/2026-07-08-staff-shifts.sql`.
- Plan gate: `src/lib/billing/entitlements.ts` (`hasActivePlan`).

---

**Security Reminder**: No secrets in this file — tokens/keys referenced by location only.
