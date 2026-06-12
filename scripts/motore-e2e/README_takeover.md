# Coexistence takeover — bot pause / resume E2E suite

End-to-end tests for the **Coexistence "human takeover"** flow: the owner replies
to a customer manually (from the WhatsApp Business App), which puts the bot on a
**hold** for that one conversation; the bot stays silent until the owner taps
**"Completa col bot"** in the CRM, which resumes it with full context.

## How the mechanism works (for reference)

- **Arm the hold**: `POST /api/webhooks/owner-echo` (the BSP `smb_message_echoes`
  seam) sets `guests.bot_paused_at = now()` **and** `guests.bot_paused_hold = true`,
  and appends the owner's text to the transcript as a `staff` line.
- **Engine guard** (n8n `Fetch History + Check Availability` node, wf `166QnQsGHqXDpBxa`):
  matches the guest by **last-9-digit** phone substring; if `bot_paused_hold === true`
  **OR** `bot_paused_at` is fresher than the 60s cooldown, it returns
  `{ skip: true, reason: 'bot_paused' }` and the bot says nothing. The read is in a
  try/catch that **fails OPEN** (`PATCH:pause-fetch-retry-v1`) — a Supabase hiccup can
  rarely let one message through, so the tests retry the *observation* a couple times.
- **Resume**: `POST /api/conversations/resume-bot` clears **both** flags
  (`bot_paused_at = null`, `bot_paused_hold = false`) and optionally re-triggers the
  engine with the last user message. This route is **cookie-auth + RLS-gated**, so a
  service-role script cannot drive it (RLS hides the guest → 404) — only a logged-in
  session (real UI) can.
- **Hold ≠ kill-switch**: the per-conversation hold is *silence* (`skip:true`). The
  tenant-wide **kill-switch** (`bot_config.bot_paused`, a Settings toggle) is a
  different mechanism in the `OpenAI` node that emits a *redirect auto-reply*
  (`botPaused:true`, `skip` falsy). The tests never flip the kill-switch (it's a
  business-policy value).

## The tests

| File | What it proves |
|------|----------------|
| `test_takeover_hold.py` | Baseline: book → owner echo → silent → survives 60s → resume keeps context. |
| `test_takeover_complex.py` | Multi-turn book, multi-echo, silent-while-held, isolation (a 2nd customer stays served), resume→complete, single re-arm. |
| `test_takeover_interleave.py` | **Strange patterns**: cold takeover (echo before the customer ever wrote → first msg already muted), empty echo (arms hold, no empty staff line), rapid customer↔owner ping-pong (silent every turn, staff in order), 3× resume↔re-takeover cycles. |
| `test_takeover_edges.py` | **Edge cases**: context survival across a mid-booking interruption, phone-format variance (bare digits / `whatsapp:` prefix resolve the same guest, no duplicate), intent-agnostic hold (a FAQ is muted too), hold-vs-kill-switch silence shape. |
| `test_takeover_resume_button.mjs` | **Real UI (Playwright, PROD)**: logs in as the Picnic admin, opens the held conversation, clicks the genuine **"Completa col bot"** button, asserts the real `/api/conversations/resume-bot` 200 + banner clears + DB hold clears + double-click idempotency + the bot replies to the customer after the real resume. |

## Running

```bash
# Python suites (fast engine harness; reads N8N_* + Supabase from CRM/.env.local)
python3 scripts/motore-e2e/test_takeover_interleave.py
python3 scripts/motore-e2e/test_takeover_edges.py
python3 scripts/motore-e2e/test_takeover_complex.py
python3 scripts/motore-e2e/test_takeover_hold.py

# Real-UI button test (opens a headed Chromium against PROD; ~3 min)
node scripts/motore-e2e/test_takeover_resume_button.mjs
```

Each test creates its own guest on the **PICNIC** tenant with a phone number that
shares no 9-digit substring with the others (the engine matches by last-9-digits,
so near-identical numbers cross-contaminate runs) and **cleans up** the guest,
conversation, and reservations at the end.
