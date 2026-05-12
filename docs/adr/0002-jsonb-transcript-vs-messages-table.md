# ADR 0002 — Conversation transcripts live in JSONB, not a separate table

Date: 2026-05-12

## Status

Accepted.

## Context

A canonical schema design for chat would split a `conversations` row
from a `messages` table (one row per turn). That gives us indexed
per-message queries (date range, role-based filters, full-text on
content).

When the CRM was first built, transcripts went into
`conversations.transcript` as a `jsonb` array — each turn is a
`{ role, content, ts }` object. This keeps the schema flat and lets the
ingestion webhook write a whole conversation in one upsert.

## Decision

Stick with `jsonb`. Don't normalize.

## Consequences

Pros:
- Single round-trip for the most common write (n8n appends 1-2 turns
  per call).
- The transcript travels with the conversation row, so dashboard queries
  don't need a join.
- Markdown export (Tier 2.2) and extraction (Tier 2.3) read the full
  thread in one pass.

Cons:
- Per-turn indices are impossible — we can't `WHERE role='user' AND
  content ILIKE '%alergia%'`.
- Updating a single turn requires rewriting the whole array.
- Transcript size grows unbounded; needs retention policy (Tier 4.11).

## When to revisit

If/when we need:
- Cross-conversation full-text search at scale
- Per-turn analytics (avg user response length, bot turn count, etc.)
- Streaming append for very long conversations (>100 turns)

Right now, the median transcript is 6-12 turns and dashboard load
performance is fine.
