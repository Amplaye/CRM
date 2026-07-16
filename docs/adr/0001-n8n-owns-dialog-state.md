# ADR 0001 — n8n owns the dialog state today

Date: 2026-05-12

## Status

Accepted (with planned migration in Tier 2.1 + 2.6).

## Context

When the chatbot was first built (March 2026), the fastest path to a
working WhatsApp + voice flow was to host the parser → controller →
formatter pipeline inside a single n8n workflow Code node. n8n
`staticData` was used for short-lived per-conversation state (pending
recap cards, customer language detection, awaiting confirmation flags).

Two later additions partially moved state to Supabase:
- `bot_sessions` table with `try_acquire_bot_lock` RPC for concurrency
  (FIX B33, May 2026)
- Mirror writes of session primer in `bot_sessions` (FIX B39)

But the workflow is still the source of truth for `pendingBookings`,
`pendingWaitlist`, and `customerLang`.

## Decision

For now, **n8n staticData remains authoritative** for short-lived pending
caches. The 2000-LOC mega-Code-node keeps the dialog logic as one
testable-from-the-outside-in unit. The CRM (`/api/ai/*`) stays a
passive REST API.

## Consequences

Pros:
- Single-process locality means dialog turns can read state in <1ms.
- Battle-tested with 25+ named FIX guards (B7, B11a, …, B39) over 6
  weeks of production traffic.
- Easy to inspect via the n8n UI — staff can look at staticData and a
  workflow execution to debug a stuck guest.

Cons:
- `staticData` is volatile — a workflow restart on Hostinger wipes
  pending caches mid-conversation.
- No unit tests on the controller logic; integration tests via the
  smoke test are the only safety net.
- Multi-tenant copies the entire 2000-LOC Code node per tenant.

## What changes this

Tier 2.1 (split the mega Code node) + Tier 2.6 (move pending caches to
`bot_sessions`) together unblock a clean Picnic-restart and unit-tested
controller. Plan:

1. Extract the parser prompt to `prompts/parser.<lang>.md`.
2. Extract the JS controller to `src/lib/dialog/controller.ts` with 30+
   unit tests (one per named FIX).
3. Replace the mega-Code-node with a single HTTP call to
   `/api/ai/dialog-turn`.
4. Move `pendingBookings`/`pendingWaitlist`/`customerLang` into
   `bot_sessions.session_data` with read-cache locality preserved by a
   short TTL.

Estimated ~2-3 days full-focus. The smoke test gates the rollout.
