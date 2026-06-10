-- Add the `commerciale` category to knowledge_articles.
--
-- This is the data home for the "Risposte automatiche (Listini & Info
-- commerciali)" module: an owner writes free-text articles (cake price list,
-- set menus, buffets, dish lists) as `category='commerciale'`, and the bot
-- answers commercial questions from them + proactively offers them — gated by
-- the per-tenant `commercial_info_enabled` feature flag. Free-text (not a typed
-- table) so any tenant's pricing structure fits without forked code.
--
-- Additive, low-risk: only widens the CHECK constraint, no data rewrite.
-- Idempotent: drops the old constraint by name first, then recreates it.

alter table public.knowledge_articles
  drop constraint if exists knowledge_articles_category_check;

alter table public.knowledge_articles
  add constraint knowledge_articles_category_check
  check (category in ('policies', 'menu', 'troubleshooting', 'general', 'commerciale'));
