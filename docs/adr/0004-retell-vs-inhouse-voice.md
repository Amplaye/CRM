# ADR 0004 — Retell for voice, not in-house Whisper/ElevenLabs

Date: 2026-05-12

## Status

Accepted.

## Context

Voice AI pipelines need STT (speech → text), an LLM for dialog, and TTS
(text → speech), plus low-latency streaming so the caller doesn't hear
long pauses. Picnic's voice agent ("Yerom") needs Spanish, English,
Italian, and German with consistent persona.

Two real options:
1. **Retell** — managed end-to-end. We give Retell a webhook for tool
   calls, a custom voice, and an LLM config. Retell handles STT/LLM/TTS,
   barge-in, interruption recovery, and exposes a Web SDK + Twilio
   integration.
2. **In-house** — wire OpenAI Whisper STT + GPT-5.1 + ElevenLabs TTS via
   Twilio Media Streams. We own the audio pipeline.

## Decision

Use Retell.

## Consequences

Pros:
- Out-of-the-box low-latency streaming with barge-in (hard to
  replicate).
- Voice quality of Yerom is good and consistent across languages.
- Tool-call mechanic mirrors OpenAI's function calling, so the same
  contracts (book/modify/cancel) work for voice and chat.
- Free tier covers Picnic's call volume today.

Cons:
- Vendor lock-in. Retell's tool-call schema, post-call webhook format,
  and prompt language are proprietary.
- Hardcoded user feedback on Retell's LLM model selection (memory note:
  user has said "don't propose changing the model").
- Persona prompt lives in Retell config, not in git — divergence
  between live and the `_VOICE_PROMPT_` sync file is a known risk
  (mitigated by per-session sync diff).
- Pricing is per-minute; if a single conversation runs ~5 min, cost
  is non-trivial at scale.

## When to revisit

- Retell pricing increases >2x or quality regresses on a release.
- A second tenant has a use case Retell can't model (e.g. transfer to
  human, multi-party calls).
- Compliance (eg HIPAA) requires self-hosted audio.

For now, the Retell-managed pipeline is unambiguously the right choice.
