# ADR 0003 — Twilio Sandbox for now, WA Cloud API later

Date: 2026-05-12

## Status

Accepted (transitional). Migration to WA Cloud API in Tier 5.1.

## Context

Twilio's WhatsApp Business Sandbox lets us send/receive WhatsApp messages
in dev mode against pre-approved test numbers (`whatsapp:+14155238886`).
The catch: every recipient must first send `join <keyword>` to opt in,
and conversations time out after 24h of no template.

Getting a real WhatsApp Business number requires Meta business
verification (~1-2 weeks), HSM template approval per outbound message
type, and a phone number Meta accepts.

## Decision

Run on the Sandbox until Picnic has a customer-facing prod launch. All
demos, internal tests, and the smoke test target the Sandbox number.

## Consequences

Pros:
- Zero waiting on Meta — anyone with the join keyword can test today.
- Twilio Auth Token + Account SID work the same as prod, so the
  outbound code paths are exercised.
- We can iterate the bot logic without Meta template rejection risk.

Cons:
- A real customer who hasn't joined gets ghosted by Twilio (silent
  drop). Bot-side logic can't detect this.
- The Sandbox number is shared across many Twilio accounts, so spam
  risk is non-zero.
- Twilio rate-limits Sandbox harder than WA Cloud.

## Migration trigger

When Picnic stakeholder wants to go live with a real customer audience:

1. Submit business verification to Meta via Twilio.
2. Draft HSM templates: `booking_confirm`, `reminder_24h`, `reminder_4h`,
   `noshow_cancelled`, `waitlist_offer`, `feedback_request`.
3. Submit templates for approval (turnaround ~2-5 days each).
4. Once approved, update `tenants.settings.bot_config.twilio_from_number`
   to the new approved number; n8n + `/api/send-whatsapp` will pick it
   up on the next workflow execution.
5. Disable Sandbox webhook in Twilio Console; enable the new number's
   webhook pointing at the same n8n URL.

Estimate: 1-2 weeks elapsed (mostly waiting), <1 day of code change.
