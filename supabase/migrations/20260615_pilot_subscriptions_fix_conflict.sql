-- Fix for 20260615_pilot_subscriptions.sql.
--
-- The original used a PARTIAL unique index (… where stripe_checkout_session_id is
-- not null) as the upsert conflict target. Postgres/PostgREST reject a partial
-- index as an ON CONFLICT target (SQLSTATE 42P10: "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification"), so every
-- upsert(onConflict: "stripe_checkout_session_id") in the pilot flow failed — both
-- the pending-row write at checkout AND the webhook activation write on a real
-- payment.
--
-- Replace it with a real UNIQUE CONSTRAINT. NULLs stay distinct in a unique
-- constraint, so rows created before a session id exists are still allowed.

drop index if exists public.uq_pilot_subscriptions_session;

alter table public.pilot_subscriptions
  add constraint uq_pilot_subscriptions_session unique (stripe_checkout_session_id);
