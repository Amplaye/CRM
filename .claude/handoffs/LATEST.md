# Handoff: Freemium entry-package gate + free menu branding (SHIPPED)

## Session Metadata
- Created: 2026-06-26 18:57:31
- Project: /Users/amplaye/CRM
- Branch: main
- Session duration: ~2h, single feature implementation end-to-end

### Recent Commits (for context)
  - dc063e2 feat(billing): freemium entry-package gate + free menu branding  ← THIS SESSION
  - a26daf4 Merge feat/whatsapp-embedded-signup: WhatsApp Embedded Signup onboarding pipeline
  - 416144d fix(settings): validate booking phone numbers + widen pause-message box
  - f9c76b9 fix(settings): validate booking phone numbers + widen pause-message box
  - d343abb feat(whatsapp): self-service Meta Embedded Signup onboarding pipeline

## Handoff Chain

- **Continues from**: [2026-06-26-155226-stop-hook-feedback-non-ho-ancora-visto-l.md](./2026-06-26-155226-stop-hook-feedback-non-ho-ancora-visto-l.md) — UNRELATED (that was the susan-site editor task). This session is a separate feature; no real continuation.
- **Supersedes**: None

## Current State Summary

The work is COMPLETE and SHIPPED. The user asked me to "execute the plan I wrote" — the plan file was `/Users/amplaye/.claude/plans/allora-io-non-voglio-recursive-hamster.md` (its odd name was literally the user's first message). It is a 6-step freemium "land & expand" plan for the BaliFlow CRM. All 6 steps are implemented, type-checked, tested, built, committed (dc063e2) and pushed to `main` (auto-deploys to Vercel). There is NO in-progress work. The only remaining items are two MANUAL operational follow-ups (RLS migration + tenant billing data) that are intentionally deferred — see Immediate Next Steps.

## Codebase Understanding

## Architecture Overview

- Next.js 16 (App Router) + Supabase (Postgres+Auth+Storage+RLS) + Vercel. Multi-tenant; every query is tenant-scoped.
- Billing/entitlements are the single source of truth for "is this paid thing unlocked": `src/lib/billing/entitlements.ts`. Existing helpers `entitlementFor`/`hasManagement` gate the `smart_inventory` add-on; this session added a PLAN-level gate `hasActivePlan`.
- Two plans exist: Premium (€399), Business (€329). Buying EITHER sets `settings.billing.plan` + `status`. No new plans were added.
- Dashboard pages are client components using `useTenant()` → `activeTenant.settings`. They read data DIRECTLY from Supabase via the browser client (RLS applies). The `/api/*` routes are the BOT/voice/cron engine and use `createServiceRoleClient()` which BYPASSES RLS — so they need code-level guards.
- Public menu `/m/[slug]/page.tsx` is a server component using service-role (bypasses RLS) — must stay open for entry-package tenants.
- i18n: 4 dicts in `src/lib/i18n/dictionaries/{en,it,es,de}.ts`. `en.ts` defines `export type Dictionary = typeof en`; it/es/de are typed `: Dictionary`, so EVERY key must exist in ALL FOUR files or tsc breaks.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| src/lib/billing/entitlements.ts | `hasActivePlan()` + shared `inGrace()` helper added | Core gate logic |
| src/lib/billing/entitlements.test.ts | 9 new tests for hasActivePlan (27 total, all pass) | Test reference |
| src/lib/billing/guard.ts | `assertActivePlan()` 403 guard added next to `assertManagement()` | API enforcement |
| src/components/billing/LockedPreview.tsx | NEW — crisp demos + veil + CTA for 8 locked sections | The lock UI |
| src/components/layout/Sidebar.tsx | `FREE_HREFS` + plan-lock in the nav `.map` | Sidebar lock |
| src/app/m/[slug]/page.tsx + 4 Menu* templates + MenuView.tsx | menu branding (--accent/--font-display/logo) | Free hook |
| src/lib/branding/upload-logo.ts | NEW — shared compress+upload helper | Used by GeneralTab + menu editor |
| src/app/(dashboard)/menu/page.tsx | Branding panel (~line 110 state, ~line 460 UI) | Free hook UI |
| supabase/migrations/20260626_plan_aware_rls.sql | NEW — plan-aware RLS (NOT auto-applied) | Manual deploy step |
| /Users/amplaye/.claude/plans/allora-io-non-voglio-recursive-hamster.md | The authoritative plan | Source of truth |

### Key Patterns Discovered

- `assertManagement(tenantId)` in guard.ts is the model for API gates: returns a 403 `NextResponse | null`, fail-CLOSED. `assertActivePlan` mirrors it exactly.
- `getFeatures()` derives `management_enabled` from billing; `hasActivePlan` is deliberately kept STANDALONE (not folded into getFeatures) so the plan gate stays orthogonal to the management add-on gate.
- Menu templates each define their accent token in a styled-jsx `.X-root { --brass / --bronze: #hex }` block. Changing ONLY that one line to `var(--accent, #hex)` lets a `--accent` set on the page.tsx wrapper cascade in. Derived tokens (--brass-soft/glow) intentionally keep defaults.
- next/font dynamic switching: instantiate all 3 display fonts with the SAME `variable: "--font-display"`, then apply the chosen font's `.variable` className on the wrapper — loads only that font's CSS and rebinds the var.
- Valid React guarantees all hooks precede the first top-level `return`, so inserting the gate `if (!hasActivePlan(...)) return <LockedPreview/>` immediately before the component's first `return (` is always after-all-hooks-safe.

## Work Completed

### Tasks Finished

- [x] Step 1: `hasActivePlan` + `inGrace` helper + 9 unit tests (all green)
- [x] Step 2: Menu branding — `menu_branding` settings type, accent var + logo across all 4 templates, page.tsx font/accent/logo wiring, dashboard branding panel, shared upload-logo.ts, i18n
- [x] Step 3: `LockedPreview` component with 8 crisp static demos + plan_* i18n
- [x] Step 4: Sidebar plan-lock (`FREE_HREFS` + lockKind tooltip)
- [x] Step 5: Early-return gate in all 8 core pages
- [x] Step 6: Security — `assertActivePlan` 403 on 11 bot/data API routes + 2 crons; plan-aware RLS migration
- [x] Verify (tsc clean, 625/626 tests, build exit 0), commit dc063e2, push to main
- [x] Saved project memory `freemium-entry-package-gate.md` + MEMORY.md pointer

## Files Modified

41 files (38 modified + 3 new). Key ones:
| File | Changes | Rationale |
|------|---------|-----------|
| entitlements.ts / .test.ts | hasActivePlan + inGrace + tests | Foundation gate |
| 8 dashboard pages: (dashboard)/{page,reservations,floor,waitlist,pending,guests,conversations,knowledge}/page.tsx | import + 2-line gate before main return | Cosmetic page lock |
| 11 api routes: ai/{book,availability,cancel,cancel-by-phone,modify,confirm-pending,waitlist,waitlist-process,event-request,restaurant-info} + insights | assertActivePlan 403 after auth+tenant-id | Real enforcement (service-role bypasses RLS) |
| cron/{booking-reminders,post-visit-followup} | `!hasActivePlan(settings) ||` added to feature check | No reminders for no-plan tenants |
| m/[slug]/{page,MenuView,MenuImmersive,MenuEditorial,MenuCinematic,MenuClassic}.tsx | --accent var + logoUrl prop + 3 fonts | Menu branding |
| (dashboard)/menu/page.tsx | +237 lines: branding state/handlers + Palette panel | Branding editor |
| src/components/settings/GeneralTab.tsx | refactored to use shared upload-logo.ts (−52 lines) | DRY |
| i18n/{en,it,es,de}.ts | +19 keys each (menu_branding_* + plan_locked_*) | Localization |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| `hasActivePlan` standalone, NOT in getFeatures() | fold into getFeatures vs separate | Plan gate is cross-cutting (locks many sections); keep orthogonal to the smart_inventory add-on gate so a Business tenant w/o that add-on still sees gestionale as add-on-locked |
| RESTRICTIVE RLS policies | rewrite existing policies vs add restrictive | Restrictive policies are AND-combined with existing membership policies → truly additive & reversible; never touches existing policy text |
| RLS migration file NOT auto-applied | run inline vs leave as migration | Vercel never runs Supabase migrations; applying blindly would lock out any tenant lacking billing.plan. Left inert + documented |
| LockedPreview = crisp demos under light veil (not blurred) | reuse ManagementLocked's blur vs new | Plan explicitly wants an inviting "look what you're missing" feel, distinct from the gestionale "coming soon" blur |
| Static hardcoded demo data | real pages with demo props vs static | Zero risk of live-query/data-leak; ~30-60 lines JSX each |
| Pushed straight to main, no branch | branch/PR vs main | Repo rule (memory: commit-straight-to-main) + user confirmed "procedi pure, non abbiamo clienti reali" |

## Pending Work

## Immediate Next Steps

1. (When the project gets real paying customers) Ensure each paying tenant has `settings.billing.plan` + `status` ("active"/"trialing") set, or they'll be locked into the entry package and their bot APIs will 403.
2. (When ready to enforce server-side) Apply `supabase/migrations/20260626_plan_aware_rls.sql` MANUALLY via the Supabase SQL editor/CLI. Its header has the verify query: `select id, name, settings->'billing'->>'plan', private.tenant_has_active_plan(id) from public.tenants where status in ('active','trial');`. Confirm paying tenants return has_plan=true BEFORE applying.
3. (Optional polish) Manually eyeball `/m/<slug>` with a `menu_branding` set on a test tenant to confirm the accent/font/logo look good across all 4 templates (the v1 only overrides the primary accent, not soft/glow derivates).

### Blockers/Open Questions

- [ ] None blocking. Open product question: do you want the v1 accent to also recolor the soft/glow derived tokens? Currently it does not (deliberate, to avoid auto-generated ugly shades).

### Deferred Items

- The two manual ops steps above (RLS apply + tenant billing data) — deferred by design; user said no real customers yet so no urgency.

## Context for Resuming Agent

## Important Context

THE FEATURE IS DONE AND DEPLOYED. Do not re-implement. If the user reports a problem after the Vercel deploy, the likely culprits are: (a) a tenant without `billing.plan` set now sees the lock (expected — set their billing), or (b) a visual issue in LockedPreview/menu branding. The gate logic lives in ONE place: `hasActivePlan` in src/lib/billing/entitlements.ts. The plan file `/Users/amplaye/.claude/plans/allora-io-non-voglio-recursive-hamster.md` is the spec — re-read it if anything is unclear.

## Assumptions Made

- The user's existing/future paying tenants will have `settings.billing.plan` + `status` populated by the Stripe pilot/subscription flow (PR #4). A tenant with billing but no `plan` key, or status canceled/incomplete, is treated as no-plan (locked).
- "Entry package" = no active plan = only `/menu` + `/settings` unlocked. Hosts (staff) only exist on paid tenants, so no host exception was needed in the lock.

## Potential Gotchas

- i18n key parity: en.ts defines the Dictionary type. Any new key MUST be added to all 4 dicts or tsc fails.
- The pre-existing failing test `src/lib/voice/voicemail.test.ts` (expects script without trailing "Adiós.") is UNRELATED to this work and was already broken — don't chase it as if this session caused it. 625/626 pass.
- Service-role routes (public menu, webhooks, bot) BYPASS RLS — the RLS migration does NOT protect them; the `assertActivePlan` code guards do. Conversely the dashboard browser reads are protected by RLS (once applied), not by the page-level LockedPreview (which is cosmetic).
- `npm run dev` is FORBIDDEN in this repo (CLAUDE.md). Use vitest / tsc / build, one heavy process at a time.
- When editing, watch the workspace-root warning from Next build — it's pre-existing/benign (two lockfiles), not from this work.

## Environment State

### Tools/Services Used

- vitest (`npx vitest run`), `npx tsc --noEmit`, `npm run build` — all pass (1 unrelated voicemail test fails).
- git: committed dc063e2 and pushed to origin/main. Vercel auto-deploys from main.
- Voice ask script `/Users/amplaye/.claude/voice/ask_voice.sh` is how clarifying questions are asked (Italian, per user's global CLAUDE.md).

### Active Processes

- None. No dev server, no background jobs left running.

### Environment Variables

- No env vars were added or needed for this work. (Existing: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY for the browser client; service-role key server-side. Nothing new.)

## Related Resources

- Plan (spec): /Users/amplaye/.claude/plans/allora-io-non-voglio-recursive-hamster.md
- Project memory: /Users/amplaye/.claude/projects/-Users-amplaye-CRM/memory/freemium-entry-package-gate.md
- RLS migration to apply manually: supabase/migrations/20260626_plan_aware_rls.sql
- Entitlements single source of truth: src/lib/billing/entitlements.ts

---

**Security Reminder**: No secrets in this handoff. All referenced files exist in the repo.
