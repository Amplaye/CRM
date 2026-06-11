-- Per-conversation "manual hold" for the WhatsApp bot (Coexistence human takeover).
--
-- Context: guests.bot_paused_at already pauses the bot per conversation, but the
-- engine treats it as a 60s cooldown that auto-resumes (good for the CRM inbox
-- where staff is actively typing). For the Coexistence scenario — the owner
-- replies from the WhatsApp Business App on their phone — we want the pause to
-- HOLD until the owner explicitly hands the conversation back via the CRM
-- "Completa col bot" button, because the customer may answer slowly and a
-- time-based auto-resume would re-wake the bot mid-conversation.
--
-- bot_paused_hold = true  → engine stays silent regardless of bot_paused_at age.
-- Cleared (false) by /api/conversations/resume-bot together with bot_paused_at.
alter table public.guests
  add column if not exists bot_paused_hold boolean not null default false;
