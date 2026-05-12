# Onboarding a new tenant

The recommended path is the self-serve wizard at
[`/admin/onboard`](../src/app/api/admin/onboard) — platform-admin sign-in
required. The wizard streams progress as it provisions everything below.

## What the wizard does (in order)

1. **`tenants` row** — name, slug, default `settings` (timezone, supported
   languages, empty `bot_config`).
2. **`tenant_members`** — adds the platform-admin as owner.
3. **API key** — creates a `tenant_api_keys` row (`scope=webhooks`,
   `label=onboarding-<date>`) and **shows the plaintext exactly once**.
   Save it to your password manager.
4. **Retell agent + LLM** — duplicates the template Retell config (voice
   "Yerom" + LLM `llm_*`) and assigns the new agent id to
   `settings.bot_config.retell_agent_id`.
5. **n8n workflows** — clones the 12 `[Picnic]` workflows for the new
   tenant, suffixing the name (`[<NewTenant>] Chatbot WhatsApp`, etc.).
   Search-and-replaces `626547ff-...` with the new tenant id.
6. **Knowledge base** — empty; the wizard creates an empty
   `knowledge_articles` row per default category.
7. **Smoke** — a synthetic WA message is sent through the new chatbot
   webhook to confirm the wiring.

## Pre-flight checklist

Before running the wizard, gather:

- Restaurant name + slug (e.g. `picnic`, `dental-clinic-cime`)
- Timezone (`Atlantic/Canary`, `Europe/Madrid`, etc.)
- Supported languages (subset of `es,en,it,de`)
- **Twilio sender** — either:
  - A new Sandbox keyword + the `whatsapp:+...` number, OR
  - A WA Cloud-approved business number (preferred for prod)
- **Retell template agent** — usually the Yerom-voice ES base agent
- Opening hours (one weekday → array of `{open, close}` slots)
- Restaurant phone (for fallback / apology)
- Owner phone (for owner notifications)

## Manual fallback (if wizard fails)

```sql
-- 1. tenant row
insert into public.tenants (name, slug, settings)
values ('NewTenant', 'newtenant', jsonb_build_object(
  'timezone', 'Europe/Madrid',
  'opening_hours', '{}'::jsonb,
  'bot_config', jsonb_build_object(
    'lang_default', 'es',
    'lang_supported', '["es","en"]'::jsonb,
    'crm_api_base', 'https://crm.baliflowagency.com',
    'ai_secret', '<same as AI_WEBHOOK_SECRET env>',
    'restaurant_name', 'NewTenant',
    'twilio_account_sid', '<AC...>',
    'twilio_auth_token', '<token>',
    'twilio_from_number', 'whatsapp:+...'
  )
))
returning id;
```

Then use `POST /api/admin/tenant/<id>/api-keys` to mint the API key and
`scripts/n8n-redact-twilio-fallbacks.mjs` (or similar) to clone workflows.

## After onboarding

- Walk staff through `/floor` and `/conversations` views.
- Set up Twilio webhook → n8n `https://n8n.srv1468837.hstgr.cloud/webhook/<tenant-slug>-whatsapp`.
- Run the smoke test, customized for the new tenant id.
- Add the new tenant to the smoke test (`scripts/smoke-test.mjs` uses
  `PICNIC_TENANT_ID` — add a per-tenant variant if needed).

## Limits today

- The wizard hardcodes a few literals (Retell template id, Supabase
  schema) — make sure they're current.
- Twilio Sandbox numbers cap at 1 per Twilio account; for multi-tenant
  prod, each tenant needs its own WA Business number (Meta approval ~2
  weeks).
- `bot_sessions.phone` is currently PK without `tenant_id`; same guest
  phone across two tenants will collide. Tracked in `REFACTOR_DIAGNOSIS.md`
  Tier 4.7.
